import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentIds } = await req.json();

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'documentIds array is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let deletedDocuments = 0;
    let deletedFiles = 0;

    console.log(`[DELETE-ALL] Processing ${documentIds.length} documents`);

    // Process each document individually to determine its pipeline
    for (const docId of documentIds) {
      try {
        // Try to find the document in each pipeline
        let pipeline: 'a' | 'a-hybrid' | 'b' | 'c' | null = null;
        let doc: any = null;

        // Check Pipeline A-Hybrid
        const { data: aHybridDoc } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id, file_name, file_path, storage_bucket')
          .eq('id', docId)
          .maybeSingle();

        if (aHybridDoc) {
          pipeline = 'a-hybrid';
          doc = aHybridDoc;
        }

        // Check Pipeline A
        if (!pipeline) {
          const { data: aDoc } = await supabase
            .from('pipeline_a_documents')
            .select('id, file_name, file_path, storage_bucket')
            .eq('id', docId)
            .maybeSingle();

          if (aDoc) {
            pipeline = 'a';
            doc = aDoc;
          }
        }

        // Check Pipeline B
        if (!pipeline) {
          const { data: bDoc } = await supabase
            .from('pipeline_b_documents')
            .select('id, file_name, file_path, storage_bucket')
            .eq('id', docId)
            .maybeSingle();

          if (bDoc) {
            pipeline = 'b';
            doc = bDoc;
          }
        }

        // Check Pipeline C
        if (!pipeline) {
          const { data: cDoc } = await supabase
            .from('pipeline_c_documents')
            .select('id, file_name, file_path, storage_bucket')
            .eq('id', docId)
            .maybeSingle();

          if (cDoc) {
            pipeline = 'c';
            doc = cDoc;
          }
        }

        if (!pipeline || !doc) {
          console.warn(`[DELETE-ALL] Document ${docId} not found in any pipeline`);
          continue;
        }

        console.log(`[DELETE-ALL] Deleting ${docId} from pipeline ${pipeline}`);

        if (pipeline === 'a-hybrid') {
          // Pipeline A-Hybrid deletion
          const { data: chunks } = await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .select('id')
            .eq('document_id', docId);

          if (chunks && chunks.length > 0) {
            await supabase
              .from('pipeline_a_hybrid_agent_knowledge')
              .delete()
              .in('chunk_id', chunks.map(c => c.id));
          }

          await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .delete()
            .eq('document_id', docId);

          // Delete storage file using actual stored values
          const storageBucket = doc.storage_bucket || 'pipeline-a-uploads';
          const filePath = doc.file_path || `${docId}/${doc.file_name}`;
          
          const { error: storageError } = await supabase.storage
            .from(storageBucket)
            .remove([filePath]);

          if (!storageError) {
            deletedFiles++;
          }

          await supabase
            .from('pipeline_a_hybrid_documents')
            .delete()
            .eq('id', docId);

          deletedDocuments++;

        } else if (pipeline === 'a') {
          // Pipeline A deletion
          const { data: chunks } = await supabase
            .from('pipeline_a_chunks_raw')
            .select('id')
            .eq('document_id', docId);

          if (chunks && chunks.length > 0) {
            await supabase
              .from('pipeline_a_agent_knowledge')
              .delete()
              .in('chunk_id', chunks.map(c => c.id));
          }

          await supabase
            .from('pipeline_a_chunks_raw')
            .delete()
            .eq('document_id', docId);

          const storageBucket = doc.storage_bucket || 'pipeline-a-uploads';
          const filePath = doc.file_path || `${docId}/${doc.file_name}`;
          
          const { error: storageError } = await supabase.storage
            .from(storageBucket)
            .remove([filePath]);

          if (!storageError) {
            deletedFiles++;
          }

          await supabase
            .from('pipeline_a_documents')
            .delete()
            .eq('id', docId);

          deletedDocuments++;

        } else if (pipeline === 'b') {
          // Pipeline B deletion
          const { data: chunks } = await supabase
            .from('pipeline_b_chunks_raw')
            .select('id')
            .eq('document_id', docId);

          if (chunks && chunks.length > 0) {
            await supabase
              .from('pipeline_b_agent_knowledge')
              .delete()
              .in('chunk_id', chunks.map(c => c.id));
          }

          await supabase
            .from('pipeline_b_chunks_raw')
            .delete()
            .eq('document_id', docId);

          const storageBucket = doc.storage_bucket || 'pipeline-b-uploads';
          const filePath = doc.file_path || `${docId}/${doc.file_name}`;
          
          const { error: storageError } = await supabase.storage
            .from(storageBucket)
            .remove([filePath]);

          if (!storageError) {
            deletedFiles++;
          }

          await supabase
            .from('pipeline_b_documents')
            .delete()
            .eq('id', docId);

          deletedDocuments++;

        } else if (pipeline === 'c') {
          // Pipeline C deletion
          const { data: chunks } = await supabase
            .from('pipeline_c_chunks_raw')
            .select('id')
            .eq('document_id', docId);

          if (chunks && chunks.length > 0) {
            await supabase
              .from('pipeline_c_agent_knowledge')
              .delete()
              .in('chunk_id', chunks.map(c => c.id));
          }

          await supabase
            .from('pipeline_c_chunks_raw')
            .delete()
            .eq('document_id', docId);

          const storageBucket = doc.storage_bucket || 'pipeline-c-uploads';
          const filePath = doc.file_path || `${docId}/${doc.file_name}`;
          
          const { error: storageError } = await supabase.storage
            .from(storageBucket)
            .remove([filePath]);

          if (!storageError) {
            deletedFiles++;
          }

          await supabase
            .from('pipeline_c_documents')
            .delete()
            .eq('id', docId);

          deletedDocuments++;
        }

      } catch (docError) {
        console.error(`[DELETE-ALL] Error deleting document ${docId}:`, docError);
        // Continue with next document even if one fails
      }
    }

    console.log(`[DELETE-ALL] Completed: ${deletedDocuments} documents, ${deletedFiles} files`);

    return new Response(
      JSON.stringify({
        success: true,
        deletedDocuments,
        deletedFiles,
        requestedCount: documentIds.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[DELETE-ALL] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
