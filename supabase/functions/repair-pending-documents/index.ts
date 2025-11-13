import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function tryDownloadPDF(supabase: any, filePath: string, fileName: string): Promise<boolean> {
  const variants = [filePath, `shared-pool-uploads/${filePath}`, `shared-pool-uploads/${fileName}`, fileName];
  for (const v of variants) {
    try {
      const { data, error } = await supabase.storage.from('knowledge-pdfs').download(v);
      if (!error && data) return true;
    } catch { continue; }
  }
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const result = { documentsWithChunks: { fixed: 0, errors: [] as any[] }, documentsWithoutChunks: { reprocessed: 0, deleted: 0, linksRemoved: 0, errors: [] as any[] }, totalProcessed: 0 };

    // Get all pool document IDs with chunks
    const { data: chunks } = await supabase.from('agent_knowledge').select('pool_document_id').not('pool_document_id', 'is', null);
    const docIdsWithChunks = [...new Set(chunks?.map((c: any) => c.pool_document_id) || [])];

    // PHASE 1: Documents with chunks
    const { data: docsWithChunks } = await supabase.from('knowledge_documents').select('*').eq('processing_status', 'pending_processing').in('id', docIdsWithChunks);
    
    for (const doc of docsWithChunks || []) {
      try {
        if (!doc.extracted_title || !doc.extracted_authors) {
          await supabase.functions.invoke('extract-missing-metadata', { body: { documentId: doc.id } });
        }
        await supabase.from('knowledge_documents').update({ processing_status: 'ready_for_assignment', validation_status: 'validated', processed_at: new Date().toISOString() }).eq('id', doc.id);
        result.documentsWithChunks.fixed++;
        result.totalProcessed++;
      } catch (error) {
        result.documentsWithChunks.errors.push({ id: doc.id, fileName: doc.file_name, error: error instanceof Error ? error.message : 'Unknown' });
      }
    }

    // PHASE 2: Documents without chunks
    const { data: docsWithoutChunks } = await supabase.from('knowledge_documents').select('*').eq('processing_status', 'pending_processing').not('id', 'in', docIdsWithChunks.length > 0 ? `(${docIdsWithChunks.map(id => `'${id}'`).join(',')})` : '()');
    
    for (const doc of docsWithoutChunks || []) {
      try {
        const pdfExists = await tryDownloadPDF(supabase, doc.file_path, doc.file_name);
        
        if (pdfExists) {
          await supabase.functions.invoke('process-document', { body: { documentId: doc.id } });
          result.documentsWithoutChunks.reprocessed++;
          result.totalProcessed++;
        } else {
          const { data: links } = await supabase.from('agent_document_links').select('id').eq('document_id', doc.id);
          if (links && links.length > 0) {
            await supabase.from('agent_document_links').delete().eq('document_id', doc.id);
            result.documentsWithoutChunks.linksRemoved += links.length;
          }
          await supabase.from('knowledge_documents').delete().eq('id', doc.id);
          result.documentsWithoutChunks.deleted++;
          result.totalProcessed++;
        }
      } catch (error) {
        result.documentsWithoutChunks.errors.push({ id: doc.id, fileName: doc.file_name, error: error instanceof Error ? error.message : 'Unknown' });
      }
    }

    console.log(`[repair] Fixed: ${result.documentsWithChunks.fixed}, Reprocessed: ${result.documentsWithoutChunks.reprocessed}, Deleted: ${result.documentsWithoutChunks.deleted}`);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
