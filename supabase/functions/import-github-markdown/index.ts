import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repo, path, maxFiles = 999999, filePattern = "*.md" } = await req.json();

    console.log(`📥 Importing GitHub Markdown from ${repo} (path: ${path}, max: ${maxFiles})`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!githubToken) {
      throw new Error('GitHub token non configurato');
    }

    // Get repository tree
    const [owner, repoName] = repo.split('/');
    const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/main?recursive=1`;
    
    console.log(`🌳 Fetching repository tree from: ${treeUrl}`);
    
    const treeResponse = await fetch(treeUrl, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Supabase-Function'
      }
    });

    if (!treeResponse.ok) {
      const errorText = await treeResponse.text();
      throw new Error(`GitHub API error: ${treeResponse.status} - ${errorText}`);
    }

    const treeData: GitHubTreeResponse = await treeResponse.json();
    console.log(`📊 Repository tree contains ${treeData.tree.length} items`);

    // Filter for markdown files in specified path
    const pattern = filePattern.replace('*.', '.');
    const allMarkdownFiles = treeData.tree.filter(item => 
      item.type === 'blob' && 
      item.path.startsWith(path) && 
      item.path.endsWith(pattern)
    );
    
    const markdownFiles = allMarkdownFiles.slice(0, maxFiles);

    console.log(`📄 Found ${allMarkdownFiles.length} total markdown files, importing ${markdownFiles.length}`);

    const results = {
      total: markdownFiles.length,
      saved: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const file of markdownFiles) {
      try {
        console.log(`\n⬇️ Downloading: ${file.path}`);

        // Download raw markdown content
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main/${file.path}`;
        const contentResponse = await fetch(rawUrl, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'text/plain'
          }
        });

        if (!contentResponse.ok) {
          throw new Error(`Failed to download ${file.path}: ${contentResponse.status}`);
        }

        const content = await contentResponse.text();
        console.log(`✅ Downloaded ${content.length} characters from ${file.path}`);

        // Extract frontmatter if present
        let title = file.path.split('/').pop()?.replace('.md', '') || 'Untitled';
        let description = null;

        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
          const descMatch = frontmatter.match(/description:\s*["']?([^"'\n]+)["']?/);
          
          if (titleMatch) title = titleMatch[1];
          if (descMatch) description = descMatch[1];
        }

        // Check if already exists
        const { data: existing } = await supabase
          .from('knowledge_documents')
          .select('id')
          .eq('file_name', file.path)
          .maybeSingle();

        if (existing) {
          console.log(`⏭️ Skipping ${file.path} - already exists`);
          results.skipped++;
          continue;
        }

        // Insert document with full_text directly
        const { data: document, error: insertError } = await supabase
          .from('knowledge_documents')
          .insert({
            file_name: file.path,
            file_path: rawUrl,
            extracted_title: title,
            ai_summary: description,
            full_text: content,
            text_length: content.length,
            processing_status: 'pending_processing',
            validation_status: 'pending',
            source_url: rawUrl,
            search_query: `GitHub: ${repo}`,
            metadata_extraction_method: 'vision',
            metadata_confidence: 'high',
            folder: 'Huggingface_GitHub'
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        console.log(`💾 Saved to database: ${document.id}`);

        // Trigger processing (will read from full_text)
        const { error: processError } = await supabase.functions.invoke('process-document', {
          body: { documentId: document.id }
        });

        if (processError) {
          console.error(`⚠️ Processing trigger failed for ${file.path}:`, processError);
          // Don't fail the import, just log
        } else {
          console.log(`🔄 Processing triggered for ${file.path}`);
        }

        results.saved++;

      } catch (error: any) {
        console.error(`❌ Error processing ${file.path}:`, error.message);
        results.failed++;
        results.errors.push(`${file.path}: ${error.message}`);
      }
    }

    console.log(`\n📊 Import completed:`, results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Imported ${results.saved}/${results.total} files from GitHub`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Import failed:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        details: error.stack 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
