import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MigrationStats {
  totalDocumentsFound: number;
  documentsCreated: number;
  linksCreated: number;
  chunksUpdated: number;
  errors: string[];
  documentDetails: Array<{
    documentName: string;
    agentName: string;
    chunksCount: number;
    status: 'success' | 'error';
    error?: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('=== START PDF MIGRATION TO POOL ===');
    
    const stats: MigrationStats = {
      totalDocumentsFound: 0,
      documentsCreated: 0,
      linksCreated: 0,
      chunksUpdated: 0,
      errors: [],
      documentDetails: [],
    };

    // Step 1: Find all distinct documents from agent_knowledge with source_type='direct_upload'
    console.log('[STEP 1] Querying distinct documents from agent_knowledge...');
    
    const { data: agentDocs, error: queryError } = await supabase
      .from('agent_knowledge')
      .select(`
        document_name,
        agent_id,
        category,
        summary,
        created_at,
        agents!inner(name)
      `)
      .eq('source_type', 'direct_upload')
      .order('document_name')
      .order('created_at');

    if (queryError) {
      console.error('[STEP 1 ERROR]', queryError);
      throw queryError;
    }

    console.log(`[STEP 1] Found ${agentDocs?.length || 0} chunks with source_type='direct_upload'`);

    // Group by document_name and agent_id
    const groupedDocs = new Map<string, {
      document_name: string;
      agent_id: string;
      agent_name: string;
      category: string;
      summary: string;
      created_at: string;
      chunks: any[];
    }>();

    for (const doc of agentDocs || []) {
      const key = `${doc.document_name}||${doc.agent_id}`;
      if (!groupedDocs.has(key)) {
        groupedDocs.set(key, {
          document_name: doc.document_name,
          agent_id: doc.agent_id,
          agent_name: (doc.agents as any)?.name || 'Unknown',
          category: doc.category,
          summary: doc.summary,
          created_at: doc.created_at,
          chunks: [],
        });
      }
    }

    stats.totalDocumentsFound = groupedDocs.size;
    console.log(`[STEP 1] Grouped into ${stats.totalDocumentsFound} unique (document, agent) pairs`);

    // Step 2: For each unique document, create entry in knowledge_documents
    console.log('[STEP 2] Creating entries in knowledge_documents...');

    const createdDocuments = new Map<string, string>(); // document_name -> knowledge_documents.id

    for (const [key, docInfo] of groupedDocs.entries()) {
      try {
        console.log(`\n[MIGRATE] Processing: "${docInfo.document_name}" for agent "${docInfo.agent_name}"`);

        // Check if this document already exists in knowledge_documents
        const { data: existing } = await supabase
          .from('knowledge_documents')
          .select('id')
          .eq('file_name', docInfo.document_name)
          .maybeSingle();

        let documentId: string;

        if (existing) {
          console.log(`[MIGRATE] Document "${docInfo.document_name}" already exists in pool (id: ${existing.id})`);
          documentId = existing.id;
        } else {
          // Get all chunks for this document to calculate text_length
          const { data: chunks, error: chunksError } = await supabase
            .from('agent_knowledge')
            .select('content, created_at')
            .eq('document_name', docInfo.document_name)
            .eq('source_type', 'direct_upload');

          if (chunksError) throw chunksError;

          const totalTextLength = chunks?.reduce((sum, c) => sum + (c.content?.length || 0), 0) || 0;
          const earliestDate = chunks?.reduce((earliest, c) => {
            const cDate = new Date(c.created_at);
            return cDate < earliest ? cDate : earliest;
          }, new Date()) || new Date();

          console.log(`[MIGRATE] Creating new document in pool: "${docInfo.document_name}"`);
          console.log(`  - Total text length: ${totalTextLength} chars`);
          console.log(`  - Earliest upload: ${earliestDate.toISOString()}`);
          console.log(`  - Total chunks: ${chunks?.length || 0}`);

          const { data: newDoc, error: createError } = await supabase
            .from('knowledge_documents')
            .insert({
              file_name: docInfo.document_name,
              file_path: `migrated/${docInfo.document_name}`,
              validation_status: 'validated',
              processing_status: 'ready_for_assignment',
              ai_summary: docInfo.summary || 'Documento migrato dal knowledge base degli agenti',
              text_length: totalTextLength,
              created_at: earliestDate.toISOString(),
            })
            .select('id')
            .single();

          if (createError) {
            console.error(`[MIGRATE ERROR] Failed to create document "${docInfo.document_name}":`, createError);
            throw createError;
          }

          documentId = newDoc.id;
          stats.documentsCreated++;
          console.log(`[MIGRATE] ✓ Created document in pool (id: ${documentId})`);
        }

        createdDocuments.set(docInfo.document_name, documentId);

        // Step 3: Create agent_document_links
        console.log(`[LINK] Creating link for agent "${docInfo.agent_name}" -> document "${docInfo.document_name}"`);

        const { data: existingLink } = await supabase
          .from('agent_document_links')
          .select('id')
          .eq('document_id', documentId)
          .eq('agent_id', docInfo.agent_id)
          .maybeSingle();

        if (existingLink) {
          console.log(`[LINK] Link already exists (id: ${existingLink.id})`);
        } else {
          const { error: linkError } = await supabase
            .from('agent_document_links')
            .insert({
              document_id: documentId,
              agent_id: docInfo.agent_id,
              assignment_type: 'manual',
              confidence_score: 1.0,
            });

          if (linkError) {
            console.error(`[LINK ERROR] Failed to create link:`, linkError);
            throw linkError;
          }

          stats.linksCreated++;
          console.log(`[LINK] ✓ Created agent_document_links`);
        }

        // Step 4: Update chunks in agent_knowledge
        console.log(`[CHUNKS] Updating chunks for "${docInfo.document_name}" in agent "${docInfo.agent_name}"`);

        const { data: updatedChunks, error: updateError } = await supabase
          .from('agent_knowledge')
          .update({
            source_type: 'shared_pool',
            pool_document_id: documentId,
          })
          .eq('document_name', docInfo.document_name)
          .eq('agent_id', docInfo.agent_id)
          .eq('source_type', 'direct_upload')
          .select('id');

        if (updateError) {
          console.error(`[CHUNKS ERROR] Failed to update chunks:`, updateError);
          throw updateError;
        }

        const chunksCount = updatedChunks?.length || 0;
        stats.chunksUpdated += chunksCount;
        console.log(`[CHUNKS] ✓ Updated ${chunksCount} chunks (source_type -> 'pool', pool_document_id -> ${documentId})`);

        stats.documentDetails.push({
          documentName: docInfo.document_name,
          agentName: docInfo.agent_name,
          chunksCount,
          status: 'success',
        });

        console.log(`[SUCCESS] Completed migration for "${docInfo.document_name}" -> "${docInfo.agent_name}"\n`);

      } catch (error: any) {
        const errorMsg = `Failed to migrate "${docInfo.document_name}" for agent "${docInfo.agent_name}": ${error.message}`;
        console.error(`[ERROR] ${errorMsg}`);
        stats.errors.push(errorMsg);
        stats.documentDetails.push({
          documentName: docInfo.document_name,
          agentName: docInfo.agent_name,
          chunksCount: 0,
          status: 'error',
          error: error.message,
        });
      }
    }

    console.log('\n=== MIGRATION COMPLETE ===');
    console.log(`Total documents found: ${stats.totalDocumentsFound}`);
    console.log(`Documents created in pool: ${stats.documentsCreated}`);
    console.log(`Agent links created: ${stats.linksCreated}`);
    console.log(`Chunks updated: ${stats.chunksUpdated}`);
    console.log(`Errors: ${stats.errors.length}`);
    
    if (stats.errors.length > 0) {
      console.error('Errors encountered:');
      stats.errors.forEach((err, idx) => console.error(`  ${idx + 1}. ${err}`));
    }

    return new Response(
      JSON.stringify({
        success: stats.errors.length === 0,
        stats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('=== MIGRATION FAILED ===', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
