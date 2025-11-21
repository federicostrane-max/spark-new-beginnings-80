import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GitHubTreeItem {
  path: string;
  type: string;
  url: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repo, path, maxFiles = 999999, filePattern = "*.md" } = await req.json();
    console.log(`📥 Importing from ${repo}/${path}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!githubToken) throw new Error('GitHub token not configured');

    const [owner, repoName] = repo.split('/');
    const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/main?recursive=1`;
    
    const treeResponse = await fetch(treeUrl, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Supabase-Function'
      }
    });

    if (!treeResponse.ok) {
      throw new Error(`GitHub API error: ${treeResponse.status}`);
    }

    const treeData: any = await treeResponse.json();
    const pattern = filePattern.replace('*.', '.');
    const markdownFiles = treeData.tree
      .filter((item: GitHubTreeItem) => 
        item.type === 'blob' && 
        item.path.startsWith(path) && 
        item.path.endsWith(pattern)
      )
      .slice(0, maxFiles);

    console.log(`📄 Found ${markdownFiles.length} markdown files`);

    const results = { total: markdownFiles.length, saved: 0, skipped: 0, failed: 0, errors: [] as string[] };

    // Check existing
    const { data: existingDocs } = await supabase
      .from('knowledge_documents')
      .select('file_name')
      .in('file_name', markdownFiles.map((f: any) => f.path));
    
    const existingSet = new Set(existingDocs?.map(d => d.file_name) || []);

    // Determine folder
    const folderMap: Record<string, string> = {
      'huggingface/transformers': 'Huggingface_GitHub/Transformers',
      'huggingface/diffusers': 'Huggingface_GitHub/Diffusers',
      'huggingface/datasets': 'Huggingface_GitHub/Datasets',
      'huggingface/peft': 'Huggingface_GitHub/PEFT',
      'huggingface/hub-docs': 'Huggingface_GitHub/Hub'
    };
    const folder = folderMap[repo] || `GitHub/${repo}`;

    const BATCH_SIZE = 50;
    const documentsToInsert = [];

    for (const file of markdownFiles) {
      try {
        if (existingSet.has(file.path)) {
          results.skipped++;
          continue;
        }

        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main/${file.path}`;
        const contentResponse = await fetch(rawUrl, {
          headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'text/plain' }
        });

        if (!contentResponse.ok) {
          throw new Error(`Download failed: ${contentResponse.status}`);
        }

        const content = await contentResponse.text();

        // Use file path for reference (storage upload is optional, we have full_text)
        const storagePath = `github/${repo}/${file.path}`;

        // Extract frontmatter
        let title = file.path.split('/').pop()?.replace('.md', '') || 'Untitled';
        let description = '';
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const titleMatch = frontmatterMatch[1].match(/title:\s*(.+)/);
          const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/);
          if (titleMatch) title = titleMatch[1].trim();
          if (descMatch) description = descMatch[1].trim();
        }

        // Use storage path instead of raw URL
        documentsToInsert.push({
          file_name: file.path,
          file_path: storagePath,
          full_text: content,
          text_length: content.length,
          extracted_title: title,
          ai_summary: description || `GitHub docs from ${repo}`,
          folder,
          source_url: `https://github.com/${owner}/${repoName}/blob/main/${file.path}`,
          search_query: `GitHub:${repo}`,
          processing_status: 'downloaded', // Avoid triggering old processing system
          validation_status: 'validated', // GitHub docs are pre-validated
          chunking_strategy: 'sliding_window',
          metadata_extraction_method: 'text',
          metadata_confidence: 'high'
        });

        if (documentsToInsert.length >= BATCH_SIZE) {
          console.log(`📤 Inserting batch of ${documentsToInsert.length} documents...`);
          const { error, data } = await supabase.from('knowledge_documents').insert(documentsToInsert);
          if (error) {
            console.error(`❌ Batch insert error:`, error);
            console.error(`Error details:`, JSON.stringify(error, null, 2));
            results.failed += documentsToInsert.length;
            results.errors.push(`Batch error: ${error.message} (${error.code || 'no code'})`);
          } else {
            console.log(`✅ Batch inserted successfully: ${documentsToInsert.length} documents`);
            results.saved += documentsToInsert.length;
          }
          documentsToInsert.length = 0;
        }

      } catch (error: any) {
        console.error(`❌ Failed to process file ${file.path}:`, error.message);
        results.failed++;
        results.errors.push(`${file.path}: ${error.message}`);
      }
    }

    // Insert remaining
    if (documentsToInsert.length > 0) {
      console.log(`📤 Inserting final batch of ${documentsToInsert.length} documents...`);
      const { error, data } = await supabase.from('knowledge_documents').insert(documentsToInsert);
      if (error) {
        console.error(`❌ Final batch insert error:`, error);
        console.error(`Error details:`, JSON.stringify(error, null, 2));
        console.error(`Failed documents:`, documentsToInsert.map(d => d.file_name));
        results.failed += documentsToInsert.length;
        results.errors.push(`Final batch: ${error.message} (${error.code || 'no code'})`);
      } else {
        console.log(`✅ Final batch inserted successfully: ${documentsToInsert.length} documents`);
        results.saved += documentsToInsert.length;
      }
    }

    console.log(`✅ Import complete: ${results.saved} saved, ${results.skipped} skipped, ${results.failed} failed`);
    if (results.errors.length > 0) {
      console.error(`❌ Errors encountered:`, results.errors);
    }
    
    // Trigger batch processing for newly imported documents
    if (results.saved > 0) {
      console.log(`🚀 Triggering batch processing for ${results.saved} documents in folder: ${folder}`);
      try {
        supabase.functions.invoke('process-github-batch', {
          body: { batchSize: 50, folder }
        }).then(() => {
          console.log('✓ Batch processing triggered successfully');
        }).catch((err) => {
          console.warn('⚠️ Failed to trigger batch processing (non-fatal):', err);
        });
      } catch (triggerError) {
        console.warn('⚠️ Failed to trigger batch processing (non-fatal):', triggerError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Documents imported. Batch processing triggered for ${results.saved} documents.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('❌', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
