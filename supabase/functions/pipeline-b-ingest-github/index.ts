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
    const { repoUrl, branch = 'main', filePaths } = await req.json();

    if (!repoUrl || !Array.isArray(filePaths)) {
      throw new Error('Invalid request: repoUrl and filePaths array required');
    }

    console.log(`📦 Pipeline B Ingest GitHub: ${repoUrl}`);
    console.log(`📝 Files to ingest: ${filePaths.length}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const documentsToInsert = [];

    for (const filePath of filePaths) {
      try {
        console.log(`📥 Fetching: ${filePath}`);
        
        // Fetch file content from GitHub
        const rawUrl = repoUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/tree/', '/')
          .replace(branch, `${branch}/${filePath}`);

        const response = await fetch(rawUrl);
        if (!response.ok) {
          console.warn(`⚠️ Failed to fetch ${filePath}: ${response.status}`);
          continue;
        }

        const fullText = await response.text();
        const fileName = filePath.split('/').pop() || filePath;

        documentsToInsert.push({
          source_type: 'github',
          file_name: fileName,
          full_text: fullText,
          repo_url: repoUrl,
          repo_path: filePath,
          file_size_bytes: fullText.length,
          status: 'ingested',
        });

        console.log(`✓ Fetched: ${fileName} (${fullText.length} bytes)`);

      } catch (error) {
        console.error(`❌ Error fetching ${filePath}:`, error);
      }
    }

    if (documentsToInsert.length === 0) {
      throw new Error('No files could be fetched from GitHub');
    }

    // Insert all documents
    const { data: documents, error: insertError } = await supabase
      .from('pipeline_b_documents')
      .insert(documentsToInsert)
      .select();

    if (insertError) throw insertError;

    console.log(`✓ Inserted ${documents.length} documents`);
    console.log(`⏳ Status: ingested (waiting for background processing)`);

    return new Response(
      JSON.stringify({
        success: true,
        documentsIngested: documents.length,
        documentIds: documents.map(d => d.id),
        message: 'GitHub files ingested successfully. Processing will begin automatically.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Ingest GitHub error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});