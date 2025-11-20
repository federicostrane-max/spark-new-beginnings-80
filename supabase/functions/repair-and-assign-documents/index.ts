import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createLogger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunking function
function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const logger = createLogger('repair-and-assign-documents');
  
  try {
    await logger.info('🔧 Starting document repair and assignment process');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // STEP 1: Find documents with full_text but no chunks
    await logger.info('📋 Finding documents with full_text but no chunks...');
    
    const { data: documentsWithText, error: queryError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, full_text, file_path, folder')
      .not('full_text', 'is', null)
      .neq('full_text', '');

    if (queryError) throw queryError;

    // Filter documents that need chunks
    const documentsNeedingChunks = [];
    for (const doc of documentsWithText || []) {
      const { count } = await supabase
        .from('agent_knowledge')
        .select('*', { count: 'exact', head: true })
        .eq('pool_document_id', doc.id);
      
      if (count === 0) {
        documentsNeedingChunks.push(doc);
      }
    }

    await logger.info(`✅ Found ${documentsNeedingChunks.length} documents needing chunks`);

    // STEP 2: Process each document to create chunks
    const processResults = [];
    
    for (const doc of documentsNeedingChunks) {
      try {
        await logger.info(`⚙️ Processing: ${doc.file_name}`);
        
        // Chunk the text
        const chunks = chunkText(doc.full_text, 1000, 200);
        
        // Insert chunks into agent_knowledge (shared pool)
        const chunksData = chunks.map((content, index) => ({
          agent_id: null, // shared pool
          pool_document_id: doc.id,
          document_name: doc.file_name,
          content,
          category: doc.folder || 'PDF Document',
          summary: index === 0 ? `Document chunk ${index + 1}/${chunks.length}` : null,
          source_type: 'shared_pool',
          is_active: true,
          chunking_metadata: {
            chunk_index: index,
            total_chunks: chunks.length,
            chunk_size: content.length,
            overlap: 200
          }
        }));

        const { error: insertError } = await supabase
          .from('agent_knowledge')
          .insert(chunksData);

        if (insertError) throw insertError;

        // Update document status
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'ready_for_assignment',
            processed_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        processResults.push({
          documentId: doc.id,
          fileName: doc.file_name,
          chunksCreated: chunks.length,
          status: 'success'
        });

        await logger.info(`✅ Created ${chunks.length} chunks for ${doc.file_name}`);
      } catch (error: any) {
        await logger.error(`❌ Failed to process ${doc.file_name}`, { error: error.message });
        processResults.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: 'failed',
          error: error.message
        });
      }
    }

    // STEP 3: Restore assignments from most recent backup
    await logger.info('📦 Restoring assignments from most recent backup...');
    
    const { data: backups, error: backupError } = await supabase
      .from('document_assignment_backups')
      .select('*')
      .is('restored_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (backupError) throw backupError;

    let assignmentResults = { 
      restored: 0, 
      failed: 0, 
      synced: 0,
      skipped: 0,
      backupUsed: null as any
    };

    if (backups && backups.length > 0) {
      const backup = backups[0];
      assignmentResults.backupUsed = {
        id: backup.id,
        name: backup.backup_name,
        createdAt: backup.created_at,
        documentsCount: backup.documents_count
      };

      await logger.info(`Using backup: ${backup.backup_name}`);

      const assignments = backup.assignments as any[];

      for (const assignment of assignments) {
        try {
          // Check if document now has chunks
          const { count: chunkCount } = await supabase
            .from('agent_knowledge')
            .select('*', { count: 'exact', head: true })
            .eq('pool_document_id', assignment.document_id);

          if (chunkCount === 0) {
            await logger.warn(`Skipping ${assignment.document_id} - no chunks available`);
            assignmentResults.skipped++;
            continue;
          }

          // Create assignment link
          const { error: linkError } = await supabase
            .from('agent_document_links')
            .upsert({
              agent_id: assignment.agent_id,
              document_id: assignment.document_id,
              assignment_type: 'manual',
              sync_status: 'pending'
            }, {
              onConflict: 'agent_id,document_id'
            });

          if (linkError) throw linkError;

          // Sync document chunks to agent
          const { error: syncError } = await supabase.functions.invoke('sync-pool-document', {
            body: {
              documentId: assignment.document_id,
              agentId: assignment.agent_id
            }
          });

          if (syncError) {
            await logger.warn(`Sync failed for ${assignment.document_name}`, { error: syncError });
            assignmentResults.failed++;
          } else {
            assignmentResults.synced++;
            await logger.info(`✅ Synced ${assignment.document_name} to agent`);
          }

          assignmentResults.restored++;
        } catch (error: any) {
          await logger.error(`Failed to restore assignment`, { 
            document: assignment.document_id,
            error: error.message 
          });
          assignmentResults.failed++;
        }
      }

      // Mark backup as restored
      await supabase
        .from('document_assignment_backups')
        .update({
          restored_at: new Date().toISOString(),
          restored_by: 'system-auto-repair'
        })
        .eq('id', backup.id);

      await logger.info(`✅ Marked backup ${backup.id} as restored`);
    } else {
      await logger.info('ℹ️ No unrestored backups found');
    }

    // Generate final report
    const report = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        documentsProcessed: processResults.length,
        chunksCreated: processResults.filter(r => r.status === 'success')
          .reduce((sum, r) => sum + (r.chunksCreated || 0), 0),
        assignmentsRestored: assignmentResults.restored,
        documentsSynced: assignmentResults.synced,
        totalFailures: processResults.filter(r => r.status === 'failed').length + assignmentResults.failed
      },
      processing: {
        successful: processResults.filter(r => r.status === 'success').length,
        failed: processResults.filter(r => r.status === 'failed').length,
        details: processResults
      },
      assignments: {
        restored: assignmentResults.restored,
        synced: assignmentResults.synced,
        failed: assignmentResults.failed,
        skipped: assignmentResults.skipped,
        backupUsed: assignmentResults.backupUsed
      }
    };

    await logger.info('🎉 Repair and assignment process completed successfully', { 
      summary: report.summary 
    });

    return new Response(
      JSON.stringify(report),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    await logger.error('💥 Repair process failed catastrophically', { 
      error: error.message,
      stack: error.stack 
    });
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message,
        stack: error.stack
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
