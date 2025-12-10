import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GITHUB_USER_AGENT = 'Lovable-Pipeline-A-Hybrid-GitHub-Ingest/1.0';

// Minimum file size to process (skip empty files like __init__.py)
const MIN_FILE_SIZE_BYTES = 10;

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

// PDF files that will be processed by split-pdf-into-batches
const PDF_EXTENSIONS = ['.pdf'];

// Image files that should be SKIPPED
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

function isMarkdownFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith('.md') || lowerName.endsWith('.mdx');
}

// Sanitize text content to avoid database errors
function sanitizeTextContent(content: string): string {
  return content
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Build hierarchical folder path that mirrors GitHub repository structure
function buildHierarchicalFolder(baseFolder: string | null, repoName: string, filePath: string): string {
  // Extract the directory from the file path (without the filename)
  const lastSlashIndex = filePath.lastIndexOf('/');
  const directory = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '';
  
  // Build the hierarchical folder: baseFolder/repoName/directory
  const repoFolder = baseFolder ? `${baseFolder}/${repoName}` : repoName;
  return directory ? `${repoFolder}/${directory}` : repoFolder;
}

// Helper function to get default branch from repository
async function getDefaultBranch(owner: string, repo: string, githubToken?: string): Promise<string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': GITHUB_USER_AGENT,
  };
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    
    if (!response.ok) {
      console.log(`[Pipeline A-Hybrid GitHub] Could not fetch repo info (${response.status}), defaulting to 'main'`);
      return 'main';
    }
    
    const repoData = await response.json();
    return repoData.default_branch || 'main';
  } catch (error) {
    console.log(`[Pipeline A-Hybrid GitHub] Error fetching repo info, defaulting to 'main':`, error);
    return 'main';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repoUrl, branch = 'main', filePaths, importAllOrgRepos, folder } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const githubToken = Deno.env.get('GITHUB_TOKEN');
    console.log('[Pipeline A-Hybrid GitHub] Starting ingestion:', { repoUrl, importAllOrgRepos, hasToken: !!githubToken });

    // Handle organization-wide import
    if (importAllOrgRepos) {
      const orgName = repoUrl;
      console.log(`[Pipeline A-Hybrid GitHub] Fetching all repos from organization: ${orgName}`);

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
      console.log(`[Pipeline A-Hybrid GitHub] Found ${repos.length} repositories in ${orgName}`);

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
          console.log(`[Pipeline A-Hybrid GitHub] Processing repository: ${repoFullName}`);

          // Recursive call for each repository
          const { data: repoResult, error: repoError } = await supabase.functions.invoke(
            'pipeline-a-hybrid-ingest-github',
            {
              body: {
                repoUrl: repoFullName,
                branch: repo.default_branch || 'main',
                importAllOrgRepos: false,
                folder,
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
          console.error(`[Pipeline A-Hybrid GitHub] Failed to process repo ${repo.full_name}:`, repoError);
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

    // If no branch specified or 'auto', auto-detect default branch
    let effectiveBranch = branch;
    if (!branch || branch === 'auto') {
      effectiveBranch = await getDefaultBranch(owner, repo, githubToken);
      console.log(`[Pipeline A-Hybrid GitHub] Auto-detected default branch: ${effectiveBranch}`);
    }

    console.log(`[Pipeline A-Hybrid GitHub] Fetching tree from ${owner}/${repo}@${effectiveBranch}`);

    // Fetch repository tree - Try public access first, fallback to token if needed
    let treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${effectiveBranch}?recursive=1`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': GITHUB_USER_AGENT,
        },
      }
    );

    // If public access fails (404/403), retry with token for private repos
    if (!treeResponse.ok && githubToken) {
      console.log(`[Pipeline A-Hybrid GitHub] Public access failed (${treeResponse.status}), retrying with token...`);
      treeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${effectiveBranch}?recursive=1`,
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
      console.error(`[Pipeline A-Hybrid GitHub] GitHub API Error:`, {
        status: treeResponse.status,
        statusText: treeResponse.statusText,
        body: errorBody,
        repo: `${owner}/${repo}`,
        branch: effectiveBranch,
        hasToken: !!githubToken,
      });
      throw new Error(`Failed to fetch repository tree: ${treeResponse.status} ${treeResponse.statusText} - ${errorBody}`);
    }

    const treeData = await treeResponse.json();
    const allFiles: GitHubTreeItem[] = treeData.tree || [];

    console.log(`[Pipeline A-Hybrid GitHub] Found ${allFiles.length} items in repository`);

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

    console.log(`[Pipeline A-Hybrid GitHub] Filtered to ${relevantFiles.length} relevant files`);

    let filesIngested = 0;
    let filesSkipped = 0;
    let filesFailed = 0;
    let jobsCreated = 0;

    // Process files in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < relevantFiles.length; i += BATCH_SIZE) {
      const batch = relevantFiles.slice(i, i + BATCH_SIZE);

      for (const file of batch) {
        try {
          const fileName = file.path.split('/').pop() || file.path;
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${effectiveBranch}/${file.path}`;

          console.log(`[Pipeline A-Hybrid GitHub] Processing: ${file.path}`);

          // Skip images entirely
          if (isImageFile(fileName)) {
            console.log(`[Pipeline A-Hybrid GitHub] ⏭️ Skipping image file: ${fileName}`);
            filesSkipped++;
            continue;
          }

          // Check for duplicates before processing
          const { data: existingDoc } = await supabase
            .from('pipeline_a_hybrid_documents')
            .select('id')
            .eq('repo_url', repoUrl)
            .eq('repo_path', file.path)
            .maybeSingle();

          if (existingDoc) {
            console.log(`[Pipeline A-Hybrid GitHub] ⏭️ Duplicate skipped: ${file.path}`);
            filesSkipped++;
            continue;
          }

          // AMPHIBIOUS LOGIC: Text vs PDF
          if (isTextFile(fileName)) {
            // TEXT FILE: Fetch as text, store in full_text
            let contentResponse = await fetch(rawUrl, {
              headers: { 'User-Agent': GITHUB_USER_AGENT },
            });

            if (!contentResponse.ok && githubToken) {
              console.log(`[Pipeline A-Hybrid GitHub] Public content fetch failed for ${fileName}, retrying with token...`);
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

            // ⚠️ FIX: Skip empty or minimal files (e.g., empty __init__.py)
            if (sanitizedContent.length < MIN_FILE_SIZE_BYTES) {
              console.log(`[Pipeline A-Hybrid GitHub] ⏭️ Skipping empty/minimal file: ${fileName} (${sanitizedContent.length} bytes)`);
              filesSkipped++;
              continue;
            }

            // Determine source_type: markdown vs code
            const sourceType = isMarkdownFile(fileName) ? 'markdown' : 'code';

            // Insert into pipeline_a_hybrid_documents with status='pending_processing'
            const { data: doc, error: insertError } = await supabase
              .from('pipeline_a_hybrid_documents')
              .insert({
                file_name: fileName,
                file_path: file.path,
                full_text: sanitizedContent,
                source_type: sourceType,
                repo_url: repoUrl,
                repo_path: file.path,
                status: 'ingested',  // Valid status - job queue will handle processing
                file_size_bytes: sanitizedContent.length,
                storage_bucket: null,
                folder: buildHierarchicalFolder(folder, repo, file.path),
              })
              .select('id')
              .single();

            if (insertError) {
              throw new Error(`Failed to insert document: ${insertError.message}`);
            }

            console.log(`[Pipeline A-Hybrid GitHub] ✅ Text file ingested (${sourceType}): ${fileName}`);

            // ⚠️ FIX: Create job in queue instead of direct EdgeRuntime.waitUntil
            const { error: jobError } = await supabase
              .from('github_processing_jobs')
              .insert({
                document_id: doc.id,
                file_path: file.path,
                repo_url: repoUrl,
                status: 'pending',
              });

            if (jobError) {
              console.error(`[Pipeline A-Hybrid GitHub] Failed to create job for ${fileName}:`, jobError);
            } else {
              jobsCreated++;
            }

            filesIngested++;
          } else if (isPdfFile(fileName)) {
            // PDF FILE: Download, upload to storage, use split-pdf-into-batches (same as ingest-pdf)
            let binaryResponse = await fetch(rawUrl, {
              headers: { 'User-Agent': GITHUB_USER_AGENT },
            });

            if (!binaryResponse.ok && githubToken) {
              console.log(`[Pipeline A-Hybrid GitHub] Public binary fetch failed for ${fileName}, retrying with token...`);
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

            // ⚠️ FIX: Skip empty PDFs
            if (arrayBuffer.byteLength < MIN_FILE_SIZE_BYTES) {
              console.log(`[Pipeline A-Hybrid GitHub] ⏭️ Skipping empty PDF: ${fileName} (${arrayBuffer.byteLength} bytes)`);
              filesSkipped++;
              continue;
            }

            const fileBlob = new Blob([arrayBuffer]);

            // Upload to Supabase Storage
            const storagePath = `github/${owner}/${repo}/${file.path}`;
            const { error: uploadError } = await supabase.storage
              .from('pipeline-a-uploads')
              .upload(storagePath, fileBlob, {
                contentType: 'application/pdf',
                upsert: true,
              });

            if (uploadError) {
              throw new Error(`Failed to upload to storage: ${uploadError.message}`);
            }

            // Insert into pipeline_a_hybrid_documents with file_path (no full_text)
            const { data: doc, error: insertError } = await supabase
              .from('pipeline_a_hybrid_documents')
              .insert({
                file_name: fileName,
                file_path: storagePath,
                full_text: null,
                source_type: 'pdf',
                repo_url: repoUrl,
                repo_path: file.path,
                status: 'ingested',
                file_size_bytes: arrayBuffer.byteLength,
                storage_bucket: 'pipeline-a-uploads',
                folder: buildHierarchicalFolder(folder, repo, file.path),
              })
              .select('id')
              .single();

            if (insertError) {
              throw new Error(`Failed to insert document: ${insertError.message}`);
            }

            console.log(`[Pipeline A-Hybrid GitHub] ✅ PDF uploaded: ${fileName}`);

            // PDF files still use split-pdf-into-batches (existing robust pattern)
            EdgeRuntime.waitUntil(
              supabase.functions.invoke('split-pdf-into-batches', {
                body: { documentId: doc.id },
              })
            );

            filesIngested++;
          }
        } catch (fileError) {
          console.error(`[Pipeline A-Hybrid GitHub] Failed to process ${file.path}:`, fileError);
          filesFailed++;
        }
      }
    }

    console.log(`[Pipeline A-Hybrid GitHub] Ingestion complete: ${filesIngested} ingested, ${filesSkipped} skipped, ${filesFailed} failed, ${jobsCreated} jobs created`);

    // ★ EVENT-DRIVEN KICKSTART: Immediately invoke job queue processor
    // This starts processing without waiting for cron (cron serves as safety net)
    if (jobsCreated > 0) {
      console.log(`[Pipeline A-Hybrid GitHub] 🚀 Kickstarting job queue processor for ${jobsCreated} jobs...`);
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('process-github-jobs-queue', {
          body: {},
        }).then(() => {
          console.log(`[Pipeline A-Hybrid GitHub] Job queue processor invoked successfully`);
        }).catch((err: Error) => {
          console.error(`[Pipeline A-Hybrid GitHub] Failed to invoke job queue processor:`, err);
        })
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        filesIngested,
        filesSkipped,
        filesFailed,
        jobsCreated,
        repository: repoUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Pipeline A-Hybrid GitHub] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
