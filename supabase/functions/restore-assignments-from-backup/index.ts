import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RestoreRequest {
  backupId: string;
  documentIds?: string[]; // Optional: restore only specific documents
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RestoreRequest = await req.json();
    const { backupId, documentIds } = body;

    console.log(`[restore-assignments] Starting restore from backup: ${backupId}`);
    if (documentIds?.length) {
      console.log(`[restore-assignments] Restoring only ${documentIds.length} specific documents`);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    let userId = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    // ========================================
    // STEP 1: Fetch backup from database
    // ========================================
    console.log('[restore-assignments] Fetching backup...');
    
    const { data: backup, error: backupError } = await supabase
      .from('document_assignment_backups')
      .select('*')
      .eq('id', backupId)
      .single();

    if (backupError) throw backupError;
    if (!backup) {
      return new Response(
        JSON.stringify({ error: 'Backup not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[restore-assignments] Found backup: ${backup.backup_name}`);

    const backupDocuments = (backup.assignments as any).documents || [];
    
    // Filter documents if specific IDs provided
    const documentsToRestore = documentIds?.length
      ? backupDocuments.filter((d: any) => documentIds.includes(d.document_id))
      : backupDocuments;

    console.log(`[restore-assignments] Will restore ${documentsToRestore.length} documents`);

    // ========================================
    // STEP 2: Process each document
    // ========================================
    let documentsProcessed = 0;
    let assignmentsRestored = 0;
    let assignmentsSkipped = 0;
    let syncSuccesses = 0;
    let syncFailures = 0;
    const details: any[] = [];

    for (const docData of documentsToRestore) {
      const { document_id, file_name, assignments } = docData;
      
      console.log(`[restore-assignments] Processing document: ${file_name}`);

      // ========================================
      // STEP 2.1: Verify document exists and has chunks
      // ========================================
      const { data: doc, error: docError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name, full_text, processing_status')
        .eq('id', document_id)
        .maybeSingle();

      if (docError || !doc) {
        console.log(`[restore-assignments] ⚠️ Document not found: ${file_name}`);
        details.push({
          document_id,
          file_name,
          status: 'document_not_found',
          assignments_restored: 0
        });
        continue;
      }

      // Check if document has chunks (either full_text or chunks in pool)
      const { count: chunkCount } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('pool_document_id', document_id)
        .is('agent_id', null);

      if (!doc.full_text && chunkCount === 0) {
        console.log(`[restore-assignments] ⚠️ Document has no chunks: ${file_name}`);
        details.push({
          document_id,
          file_name,
          status: 'no_chunks',
          assignments_restored: 0
        });
        continue;
      }

      documentsProcessed++;

      // ========================================
      // STEP 2.2: Restore assignments
      // ========================================
      let docAssignmentsRestored = 0;
      let docAssignmentsSkipped = 0;
      let docSyncSuccesses = 0;
      let docSyncFailures = 0;

      for (const assignment of assignments) {
        const { agent_id, assignment_type, confidence_score, assigned_by } = assignment;

        // Check if assignment already exists
        const { data: existingLink } = await supabase
          .from('agent_document_links')
          .select('id')
          .eq('document_id', document_id)
          .eq('agent_id', agent_id)
          .maybeSingle();

        if (existingLink) {
          console.log(`[restore-assignments] ⏭️ Assignment already exists: ${file_name} → Agent ${agent_id}`);
          assignmentsSkipped++;
          docAssignmentsSkipped++;
          continue;
        }

        // Create assignment
        const { error: linkError } = await supabase
          .from('agent_document_links')
          .insert({
            document_id,
            agent_id,
            assignment_type: assignment_type || 'manual',
            confidence_score: confidence_score || null,
            assigned_by: assigned_by || userId,
            sync_status: 'pending'
          });

        if (linkError) {
          console.error(`[restore-assignments] ❌ Error creating assignment:`, linkError);
          continue;
        }

        assignmentsRestored++;
        docAssignmentsRestored++;

        // ========================================
        // STEP 2.3: Sync chunks to agent
        // ========================================
        console.log(`[restore-assignments] Syncing chunks: ${file_name} → Agent ${agent_id}`);
        
        try {
          const { error: syncError } = await supabase.functions.invoke('sync-pool-document', {
            body: { documentId: document_id, agentId: agent_id }
          });

          if (syncError) {
            console.error(`[restore-assignments] ❌ Sync error:`, syncError);
            syncFailures++;
            docSyncFailures++;
          } else {
            console.log(`[restore-assignments] ✅ Sync successful`);
            syncSuccesses++;
            docSyncSuccesses++;
          }
        } catch (syncErr) {
          console.error(`[restore-assignments] ❌ Sync exception:`, syncErr);
          syncFailures++;
          docSyncFailures++;
        }
      }

      details.push({
        document_id,
        file_name,
        status: 'processed',
        assignments_restored: docAssignmentsRestored,
        assignments_skipped: docAssignmentsSkipped,
        sync_successes: docSyncSuccesses,
        sync_failures: docSyncFailures
      });
    }

    // ========================================
    // STEP 3: Update backup restoration timestamp
    // ========================================
    await supabase
      .from('document_assignment_backups')
      .update({
        restored_at: new Date().toISOString(),
        restored_by: userId
      })
      .eq('id', backupId);

    console.log('[restore-assignments] ✅ Restore completed');

    // ========================================
    // STEP 4: Return summary
    // ========================================
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          documentsProcessed,
          assignmentsRestored,
          assignmentsSkipped,
          syncSuccesses,
          syncFailures
        },
        details
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[restore-assignments] Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.toString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
