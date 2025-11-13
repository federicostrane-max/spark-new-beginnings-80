import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OverrideRequest {
  documentId: string;
  title: string;
  authors?: string[];
  notes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, title, authors, notes }: OverrideRequest = await req.json();

    if (!documentId || !title) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'documentId and title are required' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check if document exists
    const { data: existingDoc, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, extracted_title, extracted_authors')
      .eq('id', documentId)
      .single();

    if (fetchError || !existingDoc) {
      console.error('[manual-override] Document not found:', documentId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Document not found' 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[manual-override] 📝 Overriding metadata for: ${existingDoc.file_name}`);
    console.log(`  OLD: title="${existingDoc.extracted_title}" | authors=${JSON.stringify(existingDoc.extracted_authors)}`);
    console.log(`  NEW: title="${title}" | authors=${JSON.stringify(authors || [])}`);
    if (notes) {
      console.log(`  NOTES: ${notes}`);
    }

    // Update metadata with manual override
    const { error: updateError } = await supabase
      .from('knowledge_documents')
      .update({
        extracted_title: title,
        extracted_authors: authors || [],
        metadata_confidence: 'high', // Manual override = high confidence
        metadata_extraction_method: 'manual',
        metadata_extracted_at: new Date().toISOString(),
        metadata_verified_online: false, // Manual override not verified online
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('[manual-override] Update error:', updateError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: updateError.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[manual-override] ✅ Successfully updated metadata for ${existingDoc.file_name}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        documentId,
        fileName: existingDoc.file_name,
        oldMetadata: {
          title: existingDoc.extracted_title,
          authors: existingDoc.extracted_authors
        },
        newMetadata: {
          title,
          authors: authors || [],
          confidence: 'high',
          method: 'manual'
        },
        notes
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manual-override] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
