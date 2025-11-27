/**
 * Test LlamaParse JSON + Layout Extraction
 * 
 * This edge function tests LlamaParse's JSON output with extract_layout=true
 * to discover the actual structure returned by the API (reading_order, bbox format,
 * image encoding, etc.) before implementing Pipeline A-Hybrid.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { extractJsonWithLayout } from '../_shared/llamaParseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();

    if (!documentId) {
      throw new Error('documentId is required');
    }

    console.log(`[Test LlamaParse Layout] Testing document: ${documentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch document metadata
    const { data: document, error: docError } = await supabase
      .from('pipeline_a_documents')
      .select('id, file_name, file_path, storage_bucket')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error(`Document not found: ${docError?.message}`);
    }

    console.log(`[Test LlamaParse Layout] Fetching PDF from storage: ${document.file_path}`);

    // Download PDF from storage
    const { data: pdfData, error: storageError } = await supabase.storage
      .from(document.storage_bucket || 'pipeline-a-uploads')
      .download(document.file_path);

    if (storageError || !pdfData) {
      throw new Error(`Failed to download PDF: ${storageError?.message}`);
    }

    const pdfBuffer = new Uint8Array(await pdfData.arrayBuffer());
    console.log(`[Test LlamaParse Layout] PDF downloaded: ${pdfBuffer.length} bytes`);

    // Extract JSON with layout using LlamaParse
    const llamaApiKey = Deno.env.get('LLAMA_CLOUD_API_KEY');
    if (!llamaApiKey) {
      throw new Error('LLAMA_CLOUD_API_KEY not configured');
    }

    console.log(`[Test LlamaParse Layout] Starting JSON extraction with layout...`);
    const result = await extractJsonWithLayout(pdfBuffer, document.file_name, llamaApiKey);
    console.log(`[Test LlamaParse Layout] Extraction completed. Job ID: ${result.jobId}`);

    // Analyze JSON structure to discover format
    const analysis = analyzeJsonStructure(result.rawJson);

    // Save debug log to database
    const { data: logEntry, error: logError } = await supabase
      .from('llamaparse_debug_logs')
      .insert({
        document_name: document.file_name,
        parse_settings: {
          result_type: 'json',
          extract_layout: true,
          extract_images: true,
          vendor_multimodal_mode: true,
          vendor_multimodal_model_name: 'anthropic-sonnet-3.5',
        },
        raw_json_output: result.rawJson,
        images_info: analysis.images_info,
        element_types_found: analysis.element_types,
        total_elements: analysis.total_elements,
        has_reading_order: analysis.has_reading_order,
        has_bounding_boxes: analysis.has_bounding_boxes,
        bbox_format: analysis.bbox_format,
        image_format: analysis.image_format,
      })
      .select()
      .single();

    if (logError) {
      console.error('[Test LlamaParse Layout] Failed to save log:', logError);
    } else {
      console.log(`[Test LlamaParse Layout] Debug log saved: ${logEntry.id}`);
    }

    // Return summary for immediate UI display
    return new Response(
      JSON.stringify({
        success: true,
        log_id: logEntry?.id,
        summary: {
          total_elements: analysis.total_elements,
          element_types: analysis.element_types,
          has_native_reading_order: analysis.has_reading_order,
          bbox_format: analysis.bbox_format,
          image_encoding: analysis.image_format,
          images_count: analysis.images_count,
        },
        sample_elements: analysis.sample_elements,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[Test LlamaParse Layout] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Analyze JSON structure to discover format details
 */
function analyzeJsonStructure(rawJson: any) {
  const analysis = {
    total_elements: 0,
    element_types: [] as string[],
    has_reading_order: false,
    has_bounding_boxes: false,
    bbox_format: 'unknown',
    image_format: 'unknown',
    images_count: 0,
    images_info: {} as any,
    sample_elements: {} as any,
  };

  // Try to parse different possible JSON structures
  let elements: any[] = [];

  // LlamaParse might return pages array or elements array or other structures
  if (Array.isArray(rawJson)) {
    elements = rawJson;
  } else if (rawJson.pages && Array.isArray(rawJson.pages)) {
    elements = rawJson.pages.flatMap((page: any) => page.elements || []);
  } else if (rawJson.elements && Array.isArray(rawJson.elements)) {
    elements = rawJson.elements;
  }

  analysis.total_elements = elements.length;

  // Analyze each element
  const typeMap = new Map<string, any[]>();

  elements.forEach((elem) => {
    const type = elem.type || elem.element_type || 'unknown';
    
    // Track element types
    if (!typeMap.has(type)) {
      typeMap.set(type, []);
    }
    typeMap.get(type)!.push(elem);

    // Check for reading_order field
    if ('reading_order' in elem || 'readingOrder' in elem || 'order' in elem) {
      analysis.has_reading_order = true;
    }

    // Check for bounding boxes
    if (elem.bbox || elem.bounding_box || elem.boundingBox) {
      analysis.has_bounding_boxes = true;
      const bbox = elem.bbox || elem.bounding_box || elem.boundingBox;
      
      // Detect bbox format
      if (Array.isArray(bbox)) {
        analysis.bbox_format = bbox.length === 4 ? '[x1,y1,x2,y2] or [x,y,w,h]' : 'array';
      } else if (typeof bbox === 'object') {
        const keys = Object.keys(bbox);
        if (keys.includes('x') && keys.includes('y') && keys.includes('width')) {
          analysis.bbox_format = '{x,y,width,height}';
        } else {
          analysis.bbox_format = 'object (unknown keys)';
        }
      }
    }

    // Check for images
    if (type === 'image' || type === 'figure' || elem.image_data || elem.image) {
      analysis.images_count++;
      
      // Detect image encoding
      const imageData = elem.image_data || elem.image || elem.content;
      if (typeof imageData === 'string') {
        if (imageData.startsWith('data:image') || imageData.startsWith('iVBOR')) {
          analysis.image_format = 'base64';
        } else if (imageData.startsWith('http')) {
          analysis.image_format = 'url';
        } else {
          analysis.image_format = 'string (unknown)';
        }
      } else if (typeof imageData === 'object') {
        analysis.image_format = 'object/reference';
      }
    }
  });

  // Extract element types
  analysis.element_types = Array.from(typeMap.keys());

  // Create sample elements (first 2 of each type)
  typeMap.forEach((elements, type) => {
    analysis.sample_elements[type] = elements.slice(0, 2);
  });

  // Aggregate image info
  analysis.images_info = {
    total_images: analysis.images_count,
    image_format: analysis.image_format,
  };

  return analysis;
}
