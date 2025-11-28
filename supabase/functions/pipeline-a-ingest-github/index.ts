import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GITHUB_USER_AGENT = 'Lovable-Pipeline-A-GitHub-Ingest/1.0';

// Text file extensions that should be ingested as full_text (no LlamaParse needed)
const TEXT_EXTENSIONS = [
  // Documentation
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  // Configuration
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env', '.env.example',
  // Code
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs',
  '.cpp', '.c', '.h', '.cs', '.swift', '.kt', '.sh', '.bash', '.sql',
  '.php', '.html', '.css', '.scss', '.sass', '.vue', '.svelte',
];

// PDF files that will be processed by LlamaParse
const PDF_EXTENSIONS = ['.pdf'];

// Image files that should be SKIPPED (not supported)
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

interface GitHubTreeItem {
  path: string;
  type: string;
  size?: number;
  url?: string;
  sha?: string;
}

function isTextFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

function isPdfFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return PDF_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

function isImageFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

// Sanitize text content to avoid database errors
function sanitizeTextContent(content: string): string {
  return content
    .replace(/\0/g, '')  // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove control characters
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl, branch = 'main', filePaths, importAllOrgRepos } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const githubToken = Deno.env.get('GITHUB_TOKEN');
    console.log('[Pipeline A GitHub] Starting ingestion:', { repoUrl, importAllOrgRepos, hasToken: !!githubToken });

    // Handle organization-wide import
    if (importAllOrgRepos) {
      const orgName = repoUrl;
      console.log(`[Pipeline A GitHub] Fetching all repos from organization: ${orgName}`);

      const orgReposResponse = await fetch(
        `https://api.github.com/orgs/${orgName}/repos?per_page=100`,
        {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': GITHUB_USER_AGENT,
          },
        }
      );

      if (!orgReposResponse.ok) {
        throw new Error(`Failed to fetch organization repos: ${orgReposResponse.statusText}`);
      }

      const repos = await orgReposResponse.json();
      console.log(`[Pipeline A GitHub] Found ${repos.length} repositories in ${orgName}`);

      const results = {
        totalRepos: repos.length,
        successful: 0,
        failed: 0,
        repos: [] as any[],
      };

      // Process each repository recursively
      for (const repo of repos) {
        try {
          const repoFullName = repo.full_name;
          console.log(`[Pipeline A GitHub] Processing repository: ${repoFullName}`);

          // Recursive call for each repository
          const { data: repoResult, error: repoError } = await supabase.functions.invoke(
            'pipeline-a-ingest-github',
            {
              body: {
                repoUrl: repoFullName,
                branch: repo.default_branch || 'main',
                importAllOrgRepos: false,
              },
            }
          );

          if (repoError) {
            throw repoError;
          }

          results.successful++;
          results.repos.push({
            repo: repoFullName,
            status: 'success',
            filesIngested: repoResult.filesIngested,
          });
        } catch (repoError) {
          console.error(`[Pipeline A GitHub] Failed to process repo ${repo.full_name}:`, repoError);
          results.failed++;
          results.repos.push({
            repo: repo.full_name,
            status: 'failed',
            error: repoError instanceof Error ? repoError.message : 'Unknown error',
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, results }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single repository import
    const [owner, repo] = repoUrl.split('/');
    if (!owner || !repo) {
      throw new Error('Invalid repository URL format. Expected: owner/repo');
    }

    console.log(`[Pipeline A GitHub] Fetching tree from ${owner}/${repo}@${branch}`);

    // Fetch repository tree - Try public access first, fallback to token if needed
    let treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': GITHUB_USER_AGENT,
        },
      }
    );

    // If public access fails (404/403), retry with token for private repos
    if (!treeResponse.ok && githubToken) {
      console.log(`[Pipeline A GitHub] Public access failed (${treeResponse.status}), retrying with token...`);
      treeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': GITHUB_USER_AGENT,
          },
        }
      );
    }

    if (!treeResponse.ok) {
      const errorBody = await treeResponse.text();
      console.error(`[Pipeline A GitHub] GitHub API Error:`, {
        status: treeResponse.status,
        statusText: treeResponse.statusText,
        body: errorBody,
        repo: `${owner}/${repo}`,
        branch,
        hasToken: !!githubToken,
      });
      throw new Error(`Failed to fetch repository tree: ${treeResponse.status} ${treeResponse.statusText} - ${errorBody}`);
    }

    const treeData = await treeResponse.json();
    const allFiles: GitHubTreeItem[] = treeData.tree || [];

    console.log(`[Pipeline A GitHub] Found ${allFiles.length} items in repository`);

    // Filter files: text files + PDFs
    const relevantFiles = allFiles.filter(item => {
      if (item.type !== 'blob') return false;
      const fileName = item.path.toLowerCase();
      
      // Exclude common non-relevant directories
      if (fileName.includes('node_modules/') || 
          fileName.includes('.git/') || 
          fileName.includes('dist/') ||
          fileName.includes('build/')) {
        return false;
      }

      // Include text files and PDFs only (exclude images)
      return isTextFile(fileName) || isPdfFile(fileName);
    });

    console.log(`[Pipeline A GitHub] Filtered to ${relevantFiles.length} relevant files`);

    let filesIngested = 0;
    let filesFailed = 0;

    // Process files in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < relevantFiles.length; i += BATCH_SIZE) {
      const batch = relevantFiles.slice(i, i + BATCH_SIZE);

      for (const file of batch) {
        try {
          const fileName = file.path.split('/').pop() || file.path;
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;

          console.log(`[Pipeline A GitHub] Processing: ${file.path}`);

          // Skip images entirely
          if (isImageFile(fileName)) {
            console.log(`[Pipeline A GitHub] ⏭️ Skipping image file: ${fileName}`);
            continue;
          }

          // Check for duplicates before processing
          const { data: existingDoc } = await supabase
            .from('pipeline_a_documents')
            .select('id')
            .eq('repo_url', repoUrl)
            .eq('repo_path', file.path)
            .maybeSingle();

          if (existingDoc) {
            console.log(`[Pipeline A GitHub] ⏭️ Duplicate skipped: ${file.path}`);
            continue;
          }

          // AMPHIBIOUS LOGIC: Text vs Binary
          if (isTextFile(fileName)) {
            // TEXT FILE: Fetch as text, store in full_text
            // Try public access first, fallback to token if needed
            let contentResponse = await fetch(rawUrl, {
              headers: {
                'User-Agent': GITHUB_USER_AGENT,
              },
            });

            if (!contentResponse.ok && githubToken) {
              console.log(`[Pipeline A GitHub] Public content fetch failed for ${fileName}, retrying with token...`);
              contentResponse = await fetch(rawUrl, {
                headers: { 
                  'Authorization': `token ${githubToken}`,
                  'User-Agent': GITHUB_USER_AGENT,
                },
              });
            }

            if (!contentResponse.ok) {
              throw new Error(`Failed to fetch ${file.path}: ${contentResponse.statusText}`);
            }

            const textContent = await contentResponse.text();
            const sanitizedContent = sanitizeTextContent(textContent);

            // Insert into pipeline_a_documents with full_text
            const { data: doc, error: insertError } = await supabase
              .from('pipeline_a_documents')
              .insert({
                file_name: fileName,
                file_path: file.path,
                full_text: sanitizedContent,
                source_type: 'github',
                repo_url: repoUrl,
                repo_path: file.path,
                status: 'ingested',
                file_size_bytes: sanitizedContent.length,
                storage_bucket: null,
              })
              .select('id')
              .single();

            if (insertError) {
              throw new Error(`Failed to insert document: ${insertError.message}`);
            }

            console.log(`[Pipeline A GitHub] ✅ Text file ingested: ${fileName}`);

            // Trigger event-driven processing
            EdgeRuntime.waitUntil(
              supabase.functions.invoke('pipeline-a-process-chunks', {
                body: { documentId: doc.id },
              })
            );

            filesIngested++;
          } else if (isPdfFile(fileName)) {
            // PDF FILE: Download, upload to storage, process with LlamaParse
            // Try public access first, fallback to token if needed
            let binaryResponse = await fetch(rawUrl, {
              headers: {
                'User-Agent': GITHUB_USER_AGENT,
              },
            });

            if (!binaryResponse.ok && githubToken) {
              console.log(`[Pipeline A GitHub] Public binary fetch failed for ${fileName}, retrying with token...`);
              binaryResponse = await fetch(rawUrl, {
                headers: { 
                  'Authorization': `token ${githubToken}`,
                  'User-Agent': GITHUB_USER_AGENT,
                },
              });
            }

            if (!binaryResponse.ok) {
              throw new Error(`Failed to fetch ${file.path}: ${binaryResponse.statusText}`);
            }

            const arrayBuffer = await binaryResponse.arrayBuffer();
            const fileBlob = new Blob([arrayBuffer]);

            // Upload to Supabase Storage
            const storagePath = `${owner}/${repo}/${file.path}`;
            const { error: uploadError } = await supabase.storage
              .from('pipeline-a-uploads')
              .upload(storagePath, fileBlob, {
                contentType: 'application/pdf',
                upsert: true,
              });

            if (uploadError) {
              throw new Error(`Failed to upload to storage: ${uploadError.message}`);
            }

            // Insert into pipeline_a_documents with file_path (no full_text)
            const { data: doc, error: insertError } = await supabase
              .from('pipeline_a_documents')
              .insert({
                file_name: fileName,
                file_path: storagePath,
                full_text: null,
                source_type: 'github',
                repo_url: repoUrl,
                repo_path: file.path,
                status: 'ingested',
                file_size_bytes: arrayBuffer.byteLength,
                storage_bucket: 'pipeline-a-uploads',
              })
              .select('id')
              .single();

            if (insertError) {
              throw new Error(`Failed to insert document: ${insertError.message}`);
            }

            console.log(`[Pipeline A GitHub] ✅ Binary file uploaded: ${fileName}`);

            // Trigger event-driven processing
            EdgeRuntime.waitUntil(
              supabase.functions.invoke('pipeline-a-process-chunks', {
                body: { documentId: doc.id },
              })
            );

            filesIngested++;
          }
        } catch (fileError) {
          console.error(`[Pipeline A GitHub] Failed to process ${file.path}:`, fileError);
          filesFailed++;
        }
      }
    }

    console.log(`[Pipeline A GitHub] Ingestion complete: ${filesIngested} files ingested, ${filesFailed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        filesIngested,
        filesFailed,
        repository: repoUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Pipeline A GitHub] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
