import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        result = await listFiles(token, parsedOwner, parsedRepo, params.path, params.branch);
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
  console.log(`📖 Reading file: ${owner}/${repo}/${path} (branch: ${branch})`);
  
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { 
      headers: { 
        Authorization: `Bearer ${token}`, 
        'User-Agent': 'Lovable-Agent',
        'Accept': 'application/vnd.github.v3+json'
      } 
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ GitHub API error: ${response.status} - ${errorText}`);
    throw new Error(`GitHub API error: ${response.status} - File not found or access denied`);
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
  
  const body: any = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // Properly encode UTF-8 to base64
    branch
  };
  
  if (fileSha) {
    body.sha = fileSha; // Required for updates
  }
  
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
      body: JSON.stringify(body)
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
}

async function listFiles(token: string, owner: string, repo: string, path: string = '', branch: string = 'main') {
  console.log(`📂 Listing files: ${owner}/${repo}/${path || '/'} (branch: ${branch})`);
  
  let url: string;
  let isTreeRequest = false;
  
  if (!path || path === '' || path === '/') {
    // Root directory - use tree API for full recursive listing
    url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    isTreeRequest = true;
  } else {
    // Specific directory - use contents API
    url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  }
    
  const response = await fetch(url, {
    headers: { 
      Authorization: `Bearer ${token}`, 
      'User-Agent': 'Lovable-Agent',
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ GitHub API error: ${response.status} - ${errorText}`);
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (isTreeRequest) {
    // Tree API response
    const files = data.tree.map((item: any) => ({
      path: item.path,
      type: item.type === 'blob' ? 'file' : 'dir',
      size: item.size || null,
      sha: item.sha
    }));
    
    console.log(`✅ Listed ${files.length} items (recursive tree)`);
    return { files, truncated: data.truncated };
  } else {
    // Contents API response
    const items = Array.isArray(data) ? data : [data];
    const files = items.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size || null,
      sha: item.sha
    }));
    
    console.log(`✅ Listed ${files.length} items in ${path}`);
    return { files, path };
  }
}

async function createBranch(token: string, owner: string, repo: string, newBranch: string, fromBranch: string = 'main') {
  console.log(`🌿 Creating branch: ${newBranch} from ${fromBranch} in ${owner}/${repo}`);
  
  // Get SHA of source branch
  const refResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${fromBranch}`,
    { 
      headers: { 
        Authorization: `Bearer ${token}`, 
        'User-Agent': 'Lovable-Agent',
        'Accept': 'application/vnd.github.v3+json'
      } 
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
      })
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
      body: JSON.stringify({ title, body, head, base })
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
}
