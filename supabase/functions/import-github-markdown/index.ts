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

        documentsToInsert.push({
          file_name: file.path,
          file_path: rawUrl,
          full_text: content,
          text_length: content.length,
          extracted_title: title,
          ai_summary: description || `GitHub docs from ${repo}`,
          folder,
          source_url: `https://github.com/${owner}/${repoName}/blob/main/${file.path}`,
          search_query: `GitHub:${repo}`,
          processing_status: 'pending_processing', // ✅ Trigger auto-processes
          validation_status: 'pending', // ✅ Correct state
          chunking_strategy: 'sliding_window',
          metadata_extraction_method: 'github_frontmatter',
          metadata_confidence: 'high'
        });

        if (documentsToInsert.length >= BATCH_SIZE) {
          const { error } = await supabase.from('knowledge_documents').insert(documentsToInsert);
          if (error) {
            results.failed += documentsToInsert.length;
            results.errors.push(`Batch error: ${error.message}`);
          } else {
            results.saved += documentsToInsert.length;
          }
          documentsToInsert.length = 0;
        }

      } catch (error: any) {
        results.failed++;
        results.errors.push(`${file.path}: ${error.message}`);
      }
    }

    // Insert remaining
    if (documentsToInsert.length > 0) {
      const { error } = await supabase.from('knowledge_documents').insert(documentsToInsert);
      if (error) {
        results.failed += documentsToInsert.length;
        results.errors.push(`Final batch: ${error.message}`);
      } else {
        results.saved += documentsToInsert.length;
      }
    }

    console.log(`✅ Import complete: ${results.saved} saved, ${results.skipped} skipped, ${results.failed} failed`);
    console.log('[ASYNC] Triggers will auto-process all documents');

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        message: 'Documents imported. Auto-processing started via triggers.'
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
