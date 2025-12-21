import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// Smart Fetch Helpers for External Repos
// ============================================

// Cache per evitare chiamate ripetute a /user
// Nota: potrebbe non persistere tra cold start in Supabase Edge Functions
let cachedTokenOwner: string | null = null;

async function getTokenOwner(token: string): Promise<string | null> {
  // Check per token nullo o vuoto
  if (!token || token.trim() === '') {
    console.log('⚠️ No token provided, skipping owner detection');
    return null;
  }
  
  if (cachedTokenOwner !== null) return cachedTokenOwner;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { 
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Lovable-Agent'
      },
      signal: controller.signal
    });
    
    if (response.ok) {
      const data = await response.json();
      cachedTokenOwner = data.login;
      console.log(`🔑 Token owner: ${cachedTokenOwner}`);
      return cachedTokenOwner;
    } else if (response.status === 401) {
      console.log('⚠️ Token is invalid or expired');
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message) : 'unknown error';
    console.log('⚠️ Could not determine token owner:', errorMsg);
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

async function smartGitHubFetch(
  url: string, 
  token: string, 
  owner: string, 
  tokenOwner: string | null
): Promise<{ response: Response; isOwnRepo: boolean }> {
  const isOwnRepo = !!(tokenOwner && owner.toLowerCase() === tokenOwner.toLowerCase());
  
  const headers: Record<string, string> = {
    'User-Agent': 'Lovable-Agent',
    'Accept': 'application/vnd.github.v3+json'
  };
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    if (isOwnRepo) {
      // Per i propri repo, usa sempre il token
      console.log(`🔐 Own repo detected (${owner}), using authenticated request`);
      const response = await fetch(url, { 
        headers: { ...headers, Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      return { response, isOwnRepo };
    }
    
    // Per repo esterni, prova prima SENZA token
    console.log(`🌐 External repo (${owner}), trying unauthenticated first`);
    let response = await fetch(url, { headers, signal: controller.signal });
    
    // Se rate-limited (403), unauthorized (401), o "nascosto" (404), riprova CON token
    if (response.status === 403 || response.status === 401 || response.status === 404) {
      const reason = response.status === 404 
        ? 'repo may require auth' 
        : response.status === 403 
          ? 'rate limited' 
          : 'unauthorized';
      console.log(`⚠️ Got ${response.status} (${reason}), retrying with token`);
      
      // NUOVO controller per il retry (il precedente potrebbe essere parzialmente consumato)
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), 10000);
      
      try {
        response = await fetch(url, { 
          headers: { ...headers, Authorization: `Bearer ${token}` },
          signal: retryController.signal
        });
      } finally {
        clearTimeout(retryTimeout);
      }
    }
    
    return { response, isOwnRepo };
  } finally {
    clearTimeout(timeout);
  }
}

// Helper function to parse owner/repo from various input formats
function parseOwnerRepo(owner: string, repo: string): { owner: string; repo: string } {
  let parsedOwner = owner?.trim() || '';
  let parsedRepo = repo?.trim() || '';
  
  // Case 1: owner contains full repo path like "owner/repo"
  if (parsedOwner.includes('/') && !parsedRepo) {
    const parts = parsedOwner.split('/').filter(p => p.length > 0);
    if (parts.length >= 2) {
      parsedOwner = parts[0];
      parsedRepo = parts.slice(1).join('/'); // Handle nested paths
    }
  }
  
  // Case 2: owner contains URL-like format
  if (parsedOwner.includes('github.com')) {
    const match = parsedOwner.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
    if (match) {
      parsedOwner = match[1];
      parsedRepo = match[2].replace(/\.git$/, '');
    }
  }
  
  // Case 3: repo contains owner/repo format
  if (parsedRepo.includes('/') && parsedRepo.split('/').length >= 2) {
    const parts = parsedRepo.split('/');
    if (!parsedOwner) {
      parsedOwner = parts[0];
      parsedRepo = parts.slice(1).join('/');
    }
  }
  
  console.log(`📝 [parseOwnerRepo] Input: owner="${owner}", repo="${repo}" → Parsed: owner="${parsedOwner}", repo="${parsedRepo}"`);
  
  return { owner: parsedOwner, repo: parsedRepo };
}


function sanitizeRepoPath(path: string | null | undefined) {
  return (path || '').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string,
  tokenOwner: string | null
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const { response } = await smartGitHubFetch(url, token, owner, tokenOwner);
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data?.default_branch === 'string' ? data.default_branch : null;
}

async function fetchContentsWithBranchFallback(
  token: string,
  owner: string,
  repo: string,
  tokenOwner: string | null,
  sanitizedPath: string,
  branch: string
): Promise<Response> {
  const contentsBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const baseUrl = sanitizedPath ? `${contentsBase}/${sanitizedPath}` : contentsBase;

  // 1) Try requested branch
  let { response } = await smartGitHubFetch(`${baseUrl}?ref=${encodeURIComponent(branch)}`, token, owner, tokenOwner);
  if (response.ok || response.status !== 404) return response;

  // 2) Try without ref (GitHub will use default branch)
  ({ response } = await smartGitHubFetch(baseUrl, token, owner, tokenOwner));
  if (response.ok || response.status !== 404) return response;

  // 3) Resolve default branch explicitly and retry (only if different)
  const def = await getDefaultBranch(token, owner, repo, tokenOwner);
  if (def && def !== branch) {
    console.log(`🔁 Retrying /contents/ with default_branch="${def}"`);
    ({ response } = await smartGitHubFetch(`${baseUrl}?ref=${encodeURIComponent(def)}`, token, owner, tokenOwner));
  }

  return response;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { action, ...params } = await req.json();
  const token = Deno.env.get('GITHUB_TOKEN');

  console.log(`🔧 [GitHub Tools] Action: ${action}`);
  console.log(`📥 [GitHub Tools] Raw params:`, JSON.stringify(params, null, 2));

  if (!token) {
    console.error('❌ GITHUB_TOKEN not configured');
    return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not configured' }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Parse owner/repo with robust handling
  const { owner: parsedOwner, repo: parsedRepo } = parseOwnerRepo(params.owner, params.repo);
  
  if (!parsedOwner || !parsedRepo) {
    const errorMsg = `Invalid repository parameters: owner="${params.owner}", repo="${params.repo}". Expected format: owner="username", repo="repository" or owner="username/repository"`;
    console.error(`❌ ${errorMsg}`);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`✅ [GitHub Tools] Resolved: ${parsedOwner}/${parsedRepo}`);

  try {
    let result;
    
    switch (action) {
      case 'read_file':
        result = await readFile(token, parsedOwner, parsedRepo, params.path, params.branch);
        break;
      case 'write_file':
        result = await writeFile(token, parsedOwner, parsedRepo, params.path, 
                                 params.content, params.message, params.branch, params.sha);
        break;
      case 'list_files':
        result = await listFiles(token, parsedOwner, parsedRepo, params.path, params.branch, params.recursive);
        break;
      case 'create_branch':
        result = await createBranch(token, parsedOwner, parsedRepo, 
                                    params.newBranch, params.fromBranch);
        break;
      case 'create_pr':
        result = await createPullRequest(token, parsedOwner, parsedRepo,
                                         params.title, params.body, params.head, params.base);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    console.log(`✅ [GitHub Tools] ${action} completed successfully`);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`❌ [GitHub Tools] Error in ${action}:`, error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      action 
    }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ============================================
// GitHub API Helper Functions
// ============================================

async function readFile(token: string, owner: string, repo: string, path: string, branch: string = 'main') {
  const sanitizedPath = sanitizeRepoPath(path);
  console.log(`📖 Reading file: ${owner}/${repo}/${sanitizedPath} (branch: ${branch})`);
  
  const tokenOwner = await getTokenOwner(token);
  
  try {
    const response = await fetchContentsWithBranchFallback(token, owner, repo, tokenOwner, sanitizedPath, branch);
    const { isOwnRepo } = { isOwnRepo: !!(tokenOwner && owner.toLowerCase() === tokenOwner.toLowerCase()) };
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ GitHub API error: ${response.status} - ${errorText}`);
      
      const hint = !isOwnRepo 
        ? ' (Note: This may be a private repository you don\'t have access to)'
        : '';
      throw new Error(`GitHub API error: ${response.status} - File not found or access denied${hint}`);
    }
    
    const data = await response.json();
    
    // Handle directory vs file
    if (Array.isArray(data)) {
      throw new Error('Path is a directory, not a file. Use list_files instead.');
    }
    
    // Decode base64 content
    const content = atob(data.content.replace(/\n/g, ''));
    
    console.log(`✅ File read: ${data.path} (${data.size} bytes)`);
    
    return { 
      content, 
      sha: data.sha, 
      path: data.path, 
      size: data.size,
      encoding: data.encoding
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 10 seconds');
    }
    throw error;
  }
}

async function writeFile(
  token: string, 
  owner: string, 
  repo: string, 
  path: string, 
  content: string, 
  message: string, 
  branch: string = 'main', 
  sha: string | null = null
) {
  console.log(`✏️ Writing file: ${owner}/${repo}/${path} (branch: ${branch})`);
  
  // If no SHA provided, try to get it (for updates)
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existingFile = await readFile(token, owner, repo, path, branch);
      fileSha = existingFile.sha;
      console.log(`📝 Updating existing file (sha: ${fileSha})`);
    } catch {
      console.log(`📝 Creating new file`);
    }
  }
  
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // Properly encode UTF-8 to base64
    branch
  };
  
  if (fileSha) {
    body.sha = fileSha; // Required for updates
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lovable-Agent',
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ GitHub write failed: ${response.status} - ${error}`);
      throw new Error(`GitHub write failed: ${response.status} - ${error}`);
    }
    
    const result = await response.json();
    console.log(`✅ File written: ${result.content.path} (commit: ${result.commit.sha.slice(0, 7)})`);
    
    return {
      success: true,
      path: result.content.path,
      sha: result.content.sha,
      commit_sha: result.commit.sha,
      commit_message: message,
      commit_url: result.commit.html_url
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 10 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function listFiles(
  token: string, 
  owner: string, 
  repo: string, 
  path: string = '', 
  branch: string = 'main',
  recursive: boolean = false
) {
  const sanitizedPath = sanitizeRepoPath(path);
  const displayPath = sanitizedPath ? `/${sanitizedPath}` : '/';

  console.log(`📂 Listing files: ${owner}/${repo}${displayPath} (branch: ${branch}, recursive: ${recursive})`);
  
  const tokenOwner = await getTokenOwner(token);
  const isOwnRepo = !!(tokenOwner && owner.toLowerCase() === tokenOwner.toLowerCase());
  
  // Warn se recursive viene ignorato per path non-root
  if (recursive && sanitizedPath) {
    console.log(`⚠️ Recursive flag ignored for non-root path: ${sanitizedPath}`);
  }
  
  // Strategia:
  // - Per listing ricorsivo su PROPRI repo (root) → /git/trees/ (richiede auth)
  // - Per tutti gli altri casi → /contents/ (con fallback branch)
  let url: string;
  let isTreeRequest = false;
  
  if (recursive && isOwnRepo && !sanitizedPath) {
    console.log(`🌳 Using /git/trees/ for recursive listing on own repo`);
    url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    isTreeRequest = true;
  } else {
    console.log(`📁 Using /contents/ for ${isOwnRepo ? 'own' : 'external'} repo`);
    url = `https://api.github.com/repos/${owner}/${repo}/contents/${sanitizedPath}?ref=${branch}`;
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    let response: Response;
    
    if (isTreeRequest) {
      // /git/trees/ richiede SEMPRE auth
      response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Lovable-Agent',
          'Accept': 'application/vnd.github.v3+json'
        },
        signal: controller.signal
      });
    } else {
      // /contents/ con fallback su branch (main/master/default)
      response = await fetchContentsWithBranchFallback(token, owner, repo, tokenOwner, sanitizedPath, branch);
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ GitHub API error: ${response.status} - ${errorText}`);
      
      const hint = !isOwnRepo 
        ? ' (Note: This may be a private repository you don\'t have access to)'
        : '';
      throw new Error(`GitHub API error: ${response.status} - Directory not found or access denied${hint}`);
    }
    
    const data = await response.json();
    let files: Array<{name?: string; path: string; type: string; size: number | null; sha: string}>;
    
    if (isTreeRequest) {
      // Risposta da /git/trees/
      files = (data.tree || []).map((item: Record<string, unknown>) => ({
        name: String(item.path).split('/').pop() || '',
        path: String(item.path),
        type: item.type === 'blob' ? 'file' : 'dir',
        size: typeof item.size === 'number' ? item.size : null,
        sha: String(item.sha)
      }));
      console.log(`✅ Listed ${files.length} items (recursive tree)`);
      return { files, path: path || '/', recursive, truncated: data.truncated };
    } else {
      // Risposta da /contents/
      const items = Array.isArray(data) ? data : [data];
      files = items.map((item: Record<string, unknown>) => ({
        name: String(item.name),
        path: String(item.path),
        type: String(item.type),
        size: typeof item.size === 'number' ? item.size : null,
        sha: String(item.sha)
      }));
      console.log(`✅ Listed ${files.length} items in ${sanitizedPath || '/'}`);
      return { files, path: sanitizedPath || '/', recursive };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 10 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createBranch(token: string, owner: string, repo: string, newBranch: string, fromBranch: string = 'main') {
  console.log(`🌿 Creating branch: ${newBranch} from ${fromBranch} in ${owner}/${repo}`);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    // Get SHA of source branch
    const refResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${fromBranch}`,
      { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'User-Agent': 'Lovable-Agent',
          'Accept': 'application/vnd.github.v3+json'
        },
        signal: controller.signal
      }
    );
    
    if (!refResponse.ok) {
      const errorText = await refResponse.text();
      console.error(`❌ Source branch not found: ${fromBranch} - ${errorText}`);
      throw new Error(`Source branch not found: ${fromBranch}`);
    }
    
    const refData = await refResponse.json();
    const sourceSha = refData.object.sha;
    
    console.log(`📌 Source branch SHA: ${sourceSha.slice(0, 7)}`);
    
    // Create new branch
    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lovable-Agent',
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          ref: `refs/heads/${newBranch}`,
          sha: sourceSha
        }),
        signal: controller.signal
      }
    );
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`❌ Failed to create branch: ${newBranch} - ${errorText}`);
      
      // Check if branch already exists
      if (createResponse.status === 422) {
        throw new Error(`Branch '${newBranch}' already exists`);
      }
      
      throw new Error(`Failed to create branch: ${newBranch}`);
    }
    
    const result = await createResponse.json();
    console.log(`✅ Branch created: ${newBranch}`);
    
    return {
      success: true,
      branch: newBranch,
      sha: result.object.sha,
      ref: result.ref,
      from_branch: fromBranch
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 10 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createPullRequest(
  token: string, 
  owner: string, 
  repo: string, 
  title: string, 
  body: string, 
  head: string, 
  base: string = 'main'
) {
  console.log(`📝 Creating PR: "${title}" (${head} → ${base}) in ${owner}/${repo}`);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Lovable-Agent',
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({ title, body, head, base }),
        signal: controller.signal
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed to create PR: ${error}`);
      
      // Parse common errors
      if (response.status === 422) {
        const errorData = JSON.parse(error);
        if (errorData.errors?.[0]?.message?.includes('No commits')) {
          throw new Error(`Cannot create PR: No commits between ${base} and ${head}`);
        }
        if (errorData.errors?.[0]?.message?.includes('already exists')) {
          throw new Error(`A pull request already exists for ${head}`);
        }
      }
      
      throw new Error(`Failed to create PR: ${error}`);
    }
    
    const result = await response.json();
    console.log(`✅ PR created: #${result.number} - ${result.html_url}`);
    
    return {
      success: true,
      number: result.number,
      title: result.title,
      url: result.html_url,
      state: result.state,
      head: result.head.ref,
      base: result.base.ref
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out after 10 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
