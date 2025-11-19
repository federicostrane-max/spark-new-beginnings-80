import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
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
    const { repo, path, maxFiles = 100, filePattern = "*.md" } = await req.json();

    if (!repo) {
      return new Response(
        JSON.stringify({ error: 'Repository is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📚 [GitHub Docs] Fetching from ${repo}, path: ${path || 'root'}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get GitHub token if available (increases rate limit from 60 to 5000 req/hour)
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const githubHeaders: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Lovable-Docs-Fetcher'
    };
    if (githubToken) {
      githubHeaders['Authorization'] = `token ${githubToken}`;
    }

    // Step 1: Get repository tree
    const [owner, repoName] = repo.split('/');
    const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/main?recursive=1`;
    
    console.log(`🌳 Fetching repository tree from: ${treeUrl}`);
    
    const treeResponse = await fetch(treeUrl, { headers: githubHeaders });
    
    if (!treeResponse.ok) {
      const errorText = await treeResponse.text();
      throw new Error(`GitHub API error: ${treeResponse.status} - ${errorText}`);
    }

    const treeData: GitHubTreeResponse = await treeResponse.json();
    
    // Step 2: Filter markdown files matching the path
    let mdFiles = treeData.tree.filter(item => 
      item.type === 'blob' && 
      item.path.endsWith('.md') &&
      (!path || item.path.startsWith(path))
    );

    console.log(`📄 Found ${mdFiles.length} markdown files`);

    // Limit files based on maxFiles
    if (mdFiles.length > maxFiles) {
      console.log(`⚠️ Limiting to ${maxFiles} files`);
      mdFiles = mdFiles.slice(0, maxFiles);
    }

    const results = {
      total: mdFiles.length,
      processed: 0,
      saved: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Step 3: Download and save each file
    for (const file of mdFiles) {
      try {
        console.log(`⬇️ Downloading: ${file.path}`);
        
        // Get raw file content
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main/${file.path}`;
        const contentResponse = await fetch(rawUrl, { headers: githubHeaders });
        
        if (!contentResponse.ok) {
          throw new Error(`Failed to fetch ${file.path}: ${contentResponse.status}`);
        }

        const content = await contentResponse.text();
        
        // Parse frontmatter if exists
        let title = file.path.split('/').pop()?.replace('.md', '') || file.path;
        let description = '';
        
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*['"]?(.+?)['"]?\n/);
          const descMatch = frontmatter.match(/description:\s*['"]?(.+?)['"]?\n/);
          
          if (titleMatch) title = titleMatch[1];
          if (descMatch) description = descMatch[1];
        }

        // Check if document already exists
        const { data: existingDoc } = await supabase
          .from('knowledge_documents')
          .select('id, file_path')
          .eq('file_path', `github/${repo}/${file.path}`)
          .single();

        if (existingDoc) {
          console.log(`⏭️ Skipping (already exists): ${file.path}`);
          results.processed++;
          continue;
        }

        // Create a blob for storage (required for processing pipeline)
        const blob = new Blob([content], { type: 'text/markdown' });
        const fileName = `${repo.replace('/', '_')}_${file.path.replace(/\//g, '_')}`;
        
        // Upload to storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('shared-pool-uploads')
          .upload(`github/${fileName}`, blob, {
            contentType: 'text/markdown',
            upsert: false
          });

        if (uploadError) {
          throw uploadError;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('shared-pool-uploads')
          .getPublicUrl(`github/${fileName}`);

        // Save to knowledge_documents
        const { data: docData, error: insertError } = await supabase
          .from('knowledge_documents')
          .insert({
            file_name: file.path.split('/').pop() || fileName,
            file_path: `github/${repo}/${file.path}`,
            source_url: `https://github.com/${repo}/blob/main/${file.path}`,
            search_query: `GitHub: ${repo}`,
            file_size_bytes: blob.size,
            processing_status: 'downloaded',
            validation_status: 'pending',
            extracted_title: title,
            metadata_extraction_method: 'github_api',
            metadata_confidence: 'high',
            chunking_strategy: 'sliding_window'
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        console.log(`✅ Saved: ${file.path} (ID: ${docData.id})`);
        
        // Trigger processing via edge function
        const { error: processError } = await supabase.functions.invoke('process-document', {
          body: { documentId: docData.id }
        });

        if (processError) {
          console.error(`⚠️ Process trigger failed for ${file.path}:`, processError);
        }

        results.saved++;
        results.processed++;

      } catch (error: any) {
        console.error(`❌ Error processing ${file.path}:`, error.message);
        results.failed++;
        results.errors.push(`${file.path}: ${error.message}`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✨ Import complete:`, results);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Imported ${results.saved}/${results.total} documents from ${repo}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ [GitHub Docs] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
