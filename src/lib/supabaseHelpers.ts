import { supabase } from "@/integrations/supabase/client";

// Helper function for Prompt Expert to update agent prompts
export async function updateAgentPrompt(agentSlugOrId: string, newSystemPrompt: string, updatedBy?: string) {
  return supabase.functions.invoke('update-agent-prompt', {
    body: { 
      agentSlugOrId, 
      newSystemPrompt,
      updatedBy 
    }
  });
}

// Helper to update filter agent prompt
export async function updateFilterPrompt(
  newPromptContent: string, 
  filterVersion?: string,
  notes?: string
) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase.functions.invoke('update-filter-prompt', {
    body: { 
      newPromptContent,
      filterVersion,
      notes,
      updatedBy: userData.user?.id,
    }
  });
}

// Helper to force knowledge alignment analysis
export async function forceAlignmentAnalysis(agentId: string) {
  // Extract requirements
  await supabase.functions.invoke('extract-task-requirements', {
    body: { agentId }
  });
  
  // Analyze alignment with force flag
  return supabase.functions.invoke('analyze-knowledge-alignment', {
    body: { 
      agentId,
      forceReanalysis: true
    }
  });
}

// Force trigger embedding generation for all pipelines
// Call from browser console: (await import('@/lib/supabaseHelpers')).triggerAllEmbeddings()
export async function triggerAllEmbeddings() {
  console.log('🚀 Triggering embedding generation for all pipelines...\n');

  const pipelines = [
    'pipeline-a-generate-embeddings',
    'pipeline-a-hybrid-generate-embeddings',
    'pipeline-b-generate-embeddings',
    'pipeline-c-generate-embeddings',
  ];

  for (const fn of pipelines) {
    console.log(`Invoking ${fn}...`);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: {} });
      if (error) {
        console.error(`  ❌ Error: ${error.message}`);
      } else {
        console.log(`  ✅ Result:`, data);
      }
    } catch (e) {
      console.error(`  ❌ Exception:`, e);
    }
  }

  console.log('\n✅ All embedding functions triggered.');
}

// Helper to force re-extraction with cache invalidation
export async function forceReExtraction(agentId: string) {
  // Step 1: Restore all removed chunks FIRST (fresh start)
  await supabase.from('agent_knowledge')
    .update({ 
      is_active: true,
      removal_reason: null,
      removed_at: null
    })
    .eq('agent_id', agentId)
    .eq('is_active', false);
  
  // Step 2: Invalidate cache
  await supabase.from('agent_task_requirements')
    .update({ 
      extracted_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      system_prompt_hash: 'force-reextract'
    })
    .eq('agent_id', agentId);
  
  // Step 3: Re-extract requirements
  await supabase.functions.invoke('extract-task-requirements', {
    body: { agentId }
  });
  
  // Step 4: Re-analyze alignment with forceReanalysis flag
  return supabase.functions.invoke('analyze-knowledge-alignment', {
    body: { 
      agentId,
      forceReanalysis: true
    }
  });
}
