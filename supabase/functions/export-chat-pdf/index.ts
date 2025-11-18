import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExportRequest {
  conversationId: string;
  agentName: string;
  htmlContent: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversationId, agentName, htmlContent }: ExportRequest = await req.json();

    console.log(`[export-chat-pdf] Exporting conversation ${conversationId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Converti HTML in PDF usando Lovable AI
    console.log('[export-chat-pdf] Converting HTML to PDF...');
    
    const pdfResponse = await fetch('https://api.lovable.app/api/html-to-pdf', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlContent,
        options: {
          format: 'A4',
          margin: {
            top: '20mm',
            right: '15mm',
            bottom: '20mm',
            left: '15mm',
          },
          printBackground: true,
        }
      }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      throw new Error(`PDF generation failed: ${errorText}`);
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = await pdfBlob.arrayBuffer();
    
    console.log(`[export-chat-pdf] PDF generated, size: ${pdfBuffer.byteLength} bytes`);

    // Salva il PDF in Supabase Storage
    const fileName = `chat_${agentName.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
    const filePath = `${conversationId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('pdf-exports')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('[export-chat-pdf] Upload error:', uploadError);
      throw uploadError;
    }

    // Ottieni URL pubblico
    const { data: urlData } = supabase.storage
      .from('pdf-exports')
      .getPublicUrl(filePath);

    console.log(`[export-chat-pdf] PDF exported successfully: ${fileName}`);

    return new Response(JSON.stringify({ 
      success: true,
      url: urlData.publicUrl,
      fileName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[export-chat-pdf] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Export error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
