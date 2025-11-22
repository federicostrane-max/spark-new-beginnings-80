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
    const { repo, path, maxFiles = 999999, filePattern = "*.md", skipProcessing = false, importAllOrgRepos = false } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!githubToken) throw new Error('GitHub token not configured');

    // ⭐ NEW: Import all repos from organization
    if (importAllOrgRepos) {
      const orgName = repo; // In this case, repo is the organization name
      console.log(`🏢 Importing ALL repositories from organization: ${orgName}`);
      
      // Get all repos from organization
      const orgReposUrl = `https://api.github.com/orgs/${orgName}/repos?per_page=100`;
      const orgReposResponse = await fetch(orgReposUrl, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Supabase-Function'
        }
      });

      if (!orgReposResponse.ok) {
        throw new Error(`GitHub API error fetching org repos: ${orgReposResponse.status}`);
      }

      const repos = await orgReposResponse.json();
      console.log(`📚 Found ${repos.length} repositories in ${orgName}`);

      const allResults = {
        organization: orgName,
        totalRepos: repos.length,
        successful: 0,
        failed: 0,
        repos: [] as any[]
      };

      // Import each repository
      for (const repoInfo of repos) {
        const repoFullName = repoInfo.full_name; // e.g., "lovablelabs/repo-name"
        console.log(`\n📦 Importing repository: ${repoFullName}`);

        try {
          // Recursively call this same function for each repo
          const { data: repoResult, error: repoError } = await supabase.functions.invoke(
            'import-github-markdown',
            {
              body: {
                repo: repoFullName,
                path: path || "",
                maxFiles,
                filePattern,
                skipProcessing,
                importAllOrgRepos: false // Important: don't recurse infinitely!
              }
            }
          );

          if (repoError) {
            console.error(`❌ Failed to import ${repoFullName}:`, repoError);
            allResults.failed++;
            allResults.repos.push({
              name: repoFullName,
              status: 'failed',
              error: repoError.message
            });
          } else {
            console.log(`✅ Successfully imported ${repoFullName}`);
            allResults.successful++;
            allResults.repos.push({
              name: repoFullName,
              status: 'success',
              results: repoResult
            });
          }
        } catch (error: any) {
          console.error(`❌ Exception importing ${repoFullName}:`, error);
          allResults.failed++;
          allResults.repos.push({
            name: repoFullName,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`\n🎉 Organization import complete: ${allResults.successful} successful, ${allResults.failed} failed`);

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'organization',
          results: allResults,
          message: `Imported ${allResults.successful}/${allResults.totalRepos} repositories from ${orgName}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // ⭐ ORIGINAL: Single repository import
    console.log(`📥 Importing from ${repo}/${path}`);

    // Validate repo format for single repo
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName || repo.split('/').length !== 2) {
      throw new Error(`Invalid repository format: "${repo}". Expected format: "owner/repository" (e.g., "facebook/react", "huggingface/transformers")`);
    }

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
    
    // 🔍 DEBUG: Log tree data
    console.log(`🌳 GitHub tree response:`, {
      totalEntries: treeData.tree?.length || 0,
      truncated: treeData.truncated,
      sha: treeData.sha
    });
    
    // Log first few entries for debugging
    if (treeData.tree && treeData.tree.length > 0) {
      console.log(`📋 First 10 tree entries:`, treeData.tree.slice(0, 10).map((e: any) => ({
        path: e.path,
        type: e.type
      })));
    }
    
    const pattern = filePattern.replace('*.', '.');
    console.log(`🔍 File pattern: "${filePattern}" → regex pattern: "${pattern}"`);
    
    // ⭐ Filtro intelligente con path opzionale - SEMPRE ricorsivo
    const markdownFiles = treeData.tree
      .filter((item: GitHubTreeItem) => {
        // Deve essere un file
        if (item.type !== 'blob') return false;
        
        // Supporta sia .md che .mdx
        const isMarkdown = item.path.endsWith('.md') || item.path.endsWith('.mdx');
        if (!isMarkdown) return false;
        
        // Escludi automaticamente cartelle comuni da ignorare
        const excludePaths = [
          '.github/',      // GitHub Actions e config
          'node_modules/', // Dependencies
          'tests/',        // Test files
          'test/',         // Test files (alt)
          '__tests__/',    // Test files
          'examples/',     // Example code (optional, can be removed if needed)
          '__pycache__/',  // Python cache
          '.git/',         // Git internals
          'dist/',         // Build output
          'build/',        // Build output
          '.vscode/',      // Editor config
          '.idea/',        // JetBrains config
          'coverage/',     // Test coverage
          'vendor/',       // Dependencies (PHP, Go)
          'target/',       // Build output (Java, Rust)
        ];
        
        // Ritorna false se il path contiene una delle cartelle da escludere
        if (excludePaths.some(exclude => item.path.includes(exclude))) {
          return false;
        }
        
        // Se path è specificato, filtra per il path (ma SEMPRE ricorsivo, non solo top-level)
        // Se path è vuoto/null/undefined → scarica TUTTO il repository
        if (path && path !== '') {
          return item.path.startsWith(path);
        }
        
        return true; // Include all remaining files
      })
      .slice(0, maxFiles);

    console.log(`📄 Found ${markdownFiles.length} markdown files${!path || path === '' ? ' (full repository scan)' : ` in ${path}`}`);
    
    // 🔍 DEBUG: Log found files
    if (markdownFiles.length > 0) {
      console.log(`📝 Files found:`, markdownFiles.map((f: any) => f.path));
    }

    // Determine base folder for repository
    const orgName = repo.split('/')[0];
    const repoBaseName = repo.split('/')[1];
    const baseFolder = `${orgName.charAt(0).toUpperCase() + orgName.slice(1)}/${repoBaseName.charAt(0).toUpperCase() + repoBaseName.slice(1)}`;

    // ⭐ Insert initial progress record (using base folder)
    const { data: progressRecord } = await supabase
      .from('github_import_progress')
      .insert({
        repo,
        folder: baseFolder,
        total_files: markdownFiles.length,
        downloaded: 0,
        processed: 0,
        failed: 0,
        status: 'discovering'
      })
      .select()
      .single();

    const progressId = progressRecord?.id;

    const results = { total: markdownFiles.length, saved: 0, skipped: 0, failed: 0, errors: [] as string[] };

    // Check existing - use file_name + folder combination to avoid false positives
    const { data: existingDocs } = await supabase
      .from('knowledge_documents')
      .select('file_name, folder')
      .in('file_name', markdownFiles.map((f: any) => f.path));
    
    // Create a set of "file_name|folder" combinations for accurate duplicate detection
    const existingSet = new Set(existingDocs?.map(d => `${d.file_name}|${d.folder}`) || []);

    const BATCH_SIZE = 50;
    const allFolders = new Set<string>();
    const documentsToInsert = [];

    for (const file of markdownFiles) {
      try {
        // Build complete folder path FIRST (before checking duplicates)
        const filePath = file.path;
        const pathParts = filePath.split('/');
        pathParts.pop(); // Remove filename
        
        // Build complete folder path
        let documentFolder = baseFolder;
        if (pathParts.length > 0) {
          documentFolder = `${baseFolder}/${pathParts.join('/')}`;
        }
        
        // Check if this specific file+folder combination exists
        const uniqueKey = `${file.path}|${documentFolder}`;
        if (existingSet.has(uniqueKey)) {
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

        // documentFolder already calculated above, just add to folders set
        
        // Add to unique folders set
        allFolders.add(documentFolder);

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
          ai_summary: null, // Force AI generation in process-document
          folder: documentFolder,
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
          
          // ⭐ Update progress every batch
          if (progressId) {
            await supabase
              .from('github_import_progress')
              .update({ 
                downloaded: results.saved + results.skipped,
                failed: results.failed,
                status: 'downloading'
              })
              .eq('id', progressId);
          }
        }

      } catch (error: any) {
        console.error(`❌ Failed to process file ${file.path}:`, error.message);
        results.failed++;
        results.errors.push(`${file.path}: ${error.message}`);
      }
    }

    // Create folder hierarchy in database
    console.log(`📁 Creating ${allFolders.size} folders in database...`);
    for (const folderPath of allFolders) {
      const parts = folderPath.split('/');
      let currentPath = '';
      
      for (let i = 0; i < parts.length; i++) {
        currentPath = i === 0 ? parts[0] : `${currentPath}/${parts[i]}`;
        const parentPath = i === 0 ? null : parts.slice(0, i).join('/');
        
        // Check if folder exists
        const { data: existing } = await supabase
          .from('folders')
          .select('id')
          .eq('name', currentPath)
          .maybeSingle();
        
        if (!existing) {
          await supabase
            .from('folders')
            .insert({
              name: currentPath,
              parent_folder: parentPath,
              description: `Imported from GitHub: ${repo}`,
              icon: 'folder',
              color: 'blue'
            });
          console.log(`✅ Created folder: ${currentPath}`);
        }
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
      
      // ⭐ Update progress after final batch
      if (progressId) {
        await supabase
          .from('github_import_progress')
          .update({ 
            downloaded: results.saved + results.skipped,
            failed: results.failed,
            status: 'downloading'
          })
          .eq('id', progressId);
      }
    }

    console.log(`✅ Import complete: ${results.saved} saved, ${results.skipped} skipped, ${results.failed} failed`);
    if (results.errors.length > 0) {
      console.error(`❌ Errors encountered:`, results.errors);
    }
    
    // Trigger continuous batch processing ONLY if skipProcessing is false
    if (results.saved > 0 && !skipProcessing) {
      console.log(`🚀 Starting continuous batch processing for ${results.saved} documents in folder: ${baseFolder}`);
      
      try {
        const BATCH_SIZE = 100; // Process 100 at a time
        let totalProcessed = 0;
        let batchNumber = 0;
        let hasMore = true;
        
        // Continue processing until no more documents are found
        while (hasMore && totalProcessed < results.saved) {
          batchNumber++;
          console.log(`\n📦 Processing batch ${batchNumber} (processed ${totalProcessed}/${results.saved} so far)...`);
          
          const { data: batchResult, error: batchError } = await supabase.functions.invoke(
            'process-github-batch',
            { body: { batchSize: BATCH_SIZE, folder: baseFolder } }
          );

          if (batchError) {
            console.error(`⚠️ Batch ${batchNumber} failed:`, batchError);
            break;
          }
          
          const processed = batchResult?.stats?.processed || 0;
          const failed = batchResult?.stats?.failed || 0;
          
          console.log(`✓ Batch ${batchNumber}: ${processed} processed, ${failed} failed`);
          
          totalProcessed += processed;
          
          // ⭐ Update progress after each batch
          if (progressId) {
            await supabase
              .from('github_import_progress')
              .update({ 
                processed: totalProcessed,
                status: 'processing'
              })
              .eq('id', progressId);
          }
          
          // If processed less than batch size, we're done
          if (processed < BATCH_SIZE) {
            hasMore = false;
            console.log('✓ All available documents processed');
          }
          
          // Safety: max 20 batches (2000 docs)
          if (batchNumber >= 20) {
            console.warn('⚠️ Reached max batch limit (20), stopping');
            break;
          }
        }
        
        console.log(`\n✅ Batch processing complete: ${totalProcessed} documents processed in ${batchNumber} batches`);
        
        // ⭐ Mark as completed
        if (progressId) {
          await supabase
            .from('github_import_progress')
            .update({ 
              status: 'completed',
              completed_at: new Date().toISOString(),
              processed: totalProcessed
            })
            .eq('id', progressId);
        }
        
      } catch (triggerError) {
        console.error('❌ Batch processing error:', triggerError);
      }
    } else if (skipProcessing) {
      console.log('⏭️ Skipping automatic batch processing (skipProcessing=true)');
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
