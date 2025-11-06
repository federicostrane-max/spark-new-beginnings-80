import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log('[auto-maintenance] Function initialized');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  let execLogId: string | null = null;
  
  try {
    console.log('[auto-maintenance] ========== STARTING AUTO-MAINTENANCE ==========');

    // 1. Crea log di esecuzione
    const { data: execLog, error: logError } = await supabase
      .from('maintenance_execution_logs')
      .insert({
        execution_status: 'running',
        execution_started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (logError || !execLog) {
      console.error('[auto-maintenance] ❌ Failed to create execution log:', logError);
      throw new Error('Failed to create execution log');
    }

    execLogId = execLog.id;
    console.log(`[auto-maintenance] ✅ Created execution log: ${execLogId}`);

    // Contatori
    let documentsFixed = 0;
    let documentsFailed = 0;
    let chunksCleaned = 0;
    let agentsSynced = 0;
    let agentsSyncFailed = 0;
    let summariesGenerated = 0;
    let summariesFailed = 0;


    // 2. FIX STUCK DOCUMENTS (validating da >10 min)
    console.log('[auto-maintenance] --- Step 1: Fixing stuck documents ---');
    
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: stuckDocs, error: stuckError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('validation_status', 'validating')
      .lt('created_at', tenMinutesAgo)
      .limit(5); // Max 5 documenti alla volta

    if (stuckError) {
      console.error('[auto-maintenance] ⚠️ Error querying stuck documents:', stuckError);
    } else if (stuckDocs && stuckDocs.length > 0) {
      console.log(`[auto-maintenance] Found ${stuckDocs.length} stuck documents`);

      for (const doc of stuckDocs) {
        // Controlla tentativi precedenti
        const { data: previousAttempts } = await supabase
          .from('maintenance_operation_details')
          .select('attempt_number')
          .eq('target_id', doc.id)
          .eq('operation_type', 'fix_stuck_document')
          .order('attempt_number', { ascending: false })
          .limit(1);

        const attemptNumber = previousAttempts && previousAttempts.length > 0 
          ? previousAttempts[0].attempt_number + 1 
          : 1;

        if (attemptNumber > 3) {
          // Fallito definitivamente
          console.log(`[auto-maintenance] ❌ Document ${doc.file_name} failed after 3 attempts`);
          
          await supabase
            .from('knowledge_documents')
            .update({ 
              validation_status: 'failed',
              validation_reason: 'Failed validation after 3 automatic retry attempts'
            })
            .eq('id', doc.id);

          await supabase
            .from('maintenance_operation_details')
            .insert({
              execution_log_id: execLogId,
              operation_type: 'fix_stuck_document',
              target_id: doc.id,
              target_name: doc.file_name,
              status: 'failed',
              attempt_number: 3,
              error_message: 'Max retry attempts reached'
            });

          documentsFailed++;
        } else {
          // Retry
          console.log(`[auto-maintenance] 🔄 Retrying document ${doc.file_name} (attempt ${attemptNumber})`);
          
          try {
            const { error: invokeError } = await supabase.functions.invoke('validate-document', {
              body: { documentId: doc.id }
            });

            if (invokeError) {
              console.error(`[auto-maintenance] ❌ Failed to invoke validate-document:`, invokeError);
              
              await supabase
                .from('maintenance_operation_details')
                .insert({
                  execution_log_id: execLogId,
                  operation_type: 'fix_stuck_document',
                  target_id: doc.id,
                  target_name: doc.file_name,
                  status: 'retry_needed',
                  attempt_number: attemptNumber,
                  error_message: invokeError.message
                });
            } else {
              // ✅ POST-OPERATION VERIFICATION
              console.log(`[auto-maintenance] ⏳ Waiting 3 seconds to verify document status...`);
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              const { data: verifiedDoc } = await supabase
                .from('knowledge_documents')
                .select('validation_status')
                .eq('id', doc.id)
                .single();
              
              const isActuallyFixed = verifiedDoc?.validation_status !== 'validating';
              
              if (isActuallyFixed) {
                console.log(`[auto-maintenance] ✅ VERIFIED: Document ${doc.file_name} successfully fixed`);
                
                await supabase
                  .from('maintenance_operation_details')
                  .insert({
                    execution_log_id: execLogId,
                    operation_type: 'fix_stuck_document',
                    target_id: doc.id,
                    target_name: doc.file_name,
                    status: 'success',
                    attempt_number: attemptNumber
                  });

                documentsFixed++;
              } else {
                console.log(`[auto-maintenance] ❌ VERIFICATION FAILED: Document ${doc.file_name} still stuck`);
                
                await supabase
                  .from('maintenance_operation_details')
                  .insert({
                    execution_log_id: execLogId,
                    operation_type: 'fix_stuck_document',
                    target_id: doc.id,
                    target_name: doc.file_name,
                    status: 'retry_needed',
                    attempt_number: attemptNumber,
                    error_message: 'Post-verification failed: document still in validating status'
                  });
              }
            }
          } catch (err) {
            console.error(`[auto-maintenance] ❌ Exception during retry:`, err);
          }
        }
      }
    } else {
      console.log('[auto-maintenance] ✅ No stuck documents found');
    }

    // 3. CLEANUP ORPHANED CHUNKS (in batches to avoid limits)
    console.log('[auto-maintenance] --- Step 2: Cleaning orphaned chunks ---');
    
    const { data: orphanedChunks, error: orphanError } = await supabase
      .rpc('find_orphaned_chunks');

    if (orphanError) {
      console.error('[auto-maintenance] ⚠️ Error finding orphaned chunks:', orphanError);
    } else if (orphanedChunks && orphanedChunks.length > 0) {
      console.log(`[auto-maintenance] Found ${orphanedChunks.length} orphaned chunks`);

      // Delete in batches of 100 to avoid "Bad Request" errors
      const BATCH_SIZE = 100;
      const totalToDelete = Math.min(orphanedChunks.length, 500); // Max 500 per run
      let deletedCount = 0;
      
      for (let i = 0; i < totalToDelete; i += BATCH_SIZE) {
        const batch = orphanedChunks.slice(i, i + BATCH_SIZE);
        const chunkIds = batch.map((c: any) => c.chunk_id);
        
        const { error: deleteError } = await supabase
          .from('agent_knowledge')
          .delete()
          .in('id', chunkIds);

        if (deleteError) {
          console.error(`[auto-maintenance] ❌ Failed to delete batch ${i / BATCH_SIZE + 1}:`, deleteError);
          break; // Stop on first error
        } else {
          deletedCount += batch.length;
          console.log(`[auto-maintenance] ✅ Deleted batch ${i / BATCH_SIZE + 1}: ${batch.length} chunks`);
          
          // Log ogni chunk eliminato (solo per questo batch)
          for (const chunk of batch) {
            await supabase
              .from('maintenance_operation_details')
              .insert({
                execution_log_id: execLogId,
                operation_type: 'cleanup_orphaned_chunk',
                target_id: chunk.chunk_id,
                target_name: chunk.document_name || 'Unknown',
                status: 'success',
                attempt_number: 1
              });
          }
        }
      }
      
      chunksCleaned = deletedCount;
      console.log(`[auto-maintenance] ✅ Total deleted: ${deletedCount} orphaned chunks`);
      
      if (orphanedChunks.length > totalToDelete) {
        console.log(`[auto-maintenance] ⚠️ ${orphanedChunks.length - totalToDelete} chunks remaining, will be processed in next run`);
      }
    } else {
      console.log('[auto-maintenance] ✅ No orphaned chunks found');
    }

    // 4. REGENERATE MISSING AI SUMMARIES
    console.log('[auto-maintenance] --- Step 3.5: Regenerating missing AI summaries ---');
    
    // Query documents without valid AI summary (null, empty, or placeholder)
    const { data: allValidatedDocs, error: summaryError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, ai_summary')
      .eq('validation_status', 'validated');

    if (summaryError) {
      console.error('[auto-maintenance] ⚠️ Error querying documents:', summaryError);
    }

    // Filter in JavaScript for documents without valid summaries
    const docsWithoutSummary = allValidatedDocs?.filter(doc => 
      !doc.ai_summary || 
      doc.ai_summary.trim() === '' || 
      doc.ai_summary === 'Documento migrato dal knowledge base degli agenti'
    ).slice(0, 5); // Max 5 documenti alla volta

    if (docsWithoutSummary && docsWithoutSummary.length > 0) {
      console.log(`[auto-maintenance] Found ${docsWithoutSummary.length} documents without AI summary`);

      for (const doc of docsWithoutSummary) {
        try {
          console.log(`[auto-maintenance] 🔄 Regenerating summary for ${doc.file_name}`);
          
          const { error: validateError } = await supabase.functions.invoke('validate-document', {
            body: { documentId: doc.id }
          });

          if (validateError) {
            console.error(`[auto-maintenance] ❌ Failed to invoke validate-document for ${doc.file_name}:`, validateError);
            summariesFailed++;
            
            await supabase
              .from('maintenance_operation_details')
              .insert({
                execution_log_id: execLogId,
                operation_type: 'regenerate_summary',
                target_id: doc.id,
                target_name: doc.file_name,
                status: 'failed',
                attempt_number: 1,
                error_message: validateError.message
              });
          } else {
            // ✅ POST-OPERATION VERIFICATION
            console.log(`[auto-maintenance] ⏳ Waiting 3 seconds for summary generation...`);
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for processing
            
            // Verify actual result in database
            const { data: verifiedDoc } = await supabase
              .from('knowledge_documents')
              .select('ai_summary')
              .eq('id', doc.id)
              .single();
            
            const isActuallyGenerated = verifiedDoc?.ai_summary && 
                                       verifiedDoc.ai_summary.trim() !== '' &&
                                       verifiedDoc.ai_summary !== 'Documento migrato dal knowledge base degli agenti';
            
            if (isActuallyGenerated) {
              console.log(`[auto-maintenance] ✅ VERIFIED: Summary successfully generated for ${doc.file_name}`);
              summariesGenerated++;
              
              await supabase
                .from('maintenance_operation_details')
                .insert({
                  execution_log_id: execLogId,
                  operation_type: 'regenerate_summary',
                  target_id: doc.id,
                  target_name: doc.file_name,
                  status: 'success',
                  attempt_number: 1
                });
            } else {
              console.log(`[auto-maintenance] ❌ VERIFICATION FAILED: Summary not generated for ${doc.file_name}`);
              summariesFailed++;
              
              await supabase
                .from('maintenance_operation_details')
                .insert({
                  execution_log_id: execLogId,
                  operation_type: 'regenerate_summary',
                  target_id: doc.id,
                  target_name: doc.file_name,
                  status: 'failed',
                  attempt_number: 1,
                  error_message: 'Post-verification failed: summary not updated in database'
                });
            }
          }
        } catch (err) {
          console.error(`[auto-maintenance] ❌ Exception regenerating summary for ${doc.file_name}:`, err);
          summariesFailed++;
        }
      }
    } else {
      console.log('[auto-maintenance] ✅ All validated documents have AI summaries');
    }

    // 5. AUTO-SYNC AGENTS
    console.log('[auto-maintenance] --- Step 3: Syncing agents ---');
    
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, name')
      .eq('active', true);

    if (agentsError) {
      console.error('[auto-maintenance] ⚠️ Error querying agents:', agentsError);
    } else if (agents && agents.length > 0) {
      console.log(`[auto-maintenance] Found ${agents.length} active agents to check`);

      for (const agent of agents) {
        try {
          // Chiama check-and-sync-all senza autoFix per vedere se ci sono problemi
          const { data: checkData, error: checkError } = await supabase.functions.invoke('check-and-sync-all', {
            body: { agentId: agent.id, autoFix: false }
          });

          if (checkError) {
            console.error(`[auto-maintenance] ⚠️ Error checking agent ${agent.name}:`, checkError);
            continue;
          }

          const statuses = checkData?.statuses || [];
          const hasIssues = statuses.some((s: any) => s.status !== 'synced');

          if (hasIssues) {
            console.log(`[auto-maintenance] 🔧 Agent ${agent.name} has sync issues`);

            // Controlla tentativi precedenti
            const { data: previousAttempts } = await supabase
              .from('maintenance_operation_details')
              .select('attempt_number')
              .eq('target_id', agent.id)
              .eq('operation_type', 'sync_agent')
              .order('attempt_number', { ascending: false })
              .limit(1);

            const attemptNumber = previousAttempts && previousAttempts.length > 0 
              ? previousAttempts[0].attempt_number + 1 
              : 1;

            if (attemptNumber > 3) {
              console.log(`[auto-maintenance] ❌ Agent ${agent.name} sync failed after 3 attempts`);
              
              await supabase
                .from('maintenance_operation_details')
                .insert({
                  execution_log_id: execLogId,
                  operation_type: 'sync_agent',
                  target_id: agent.id,
                  target_name: agent.name,
                  status: 'failed',
                  attempt_number: 3,
                  error_message: 'Max retry attempts reached'
                });

              agentsSyncFailed++;
            } else {
              // Retry con autoFix=true
              console.log(`[auto-maintenance] 🔄 Syncing agent ${agent.name} (attempt ${attemptNumber})`);
              
              const { error: syncError } = await supabase.functions.invoke('check-and-sync-all', {
                body: { agentId: agent.id, autoFix: true }
              });

              if (syncError) {
                console.error(`[auto-maintenance] ❌ Failed to sync agent ${agent.name}:`, syncError);
                
                await supabase
                  .from('maintenance_operation_details')
                  .insert({
                    execution_log_id: execLogId,
                    operation_type: 'sync_agent',
                    target_id: agent.id,
                    target_name: agent.name,
                    status: 'retry_needed',
                    attempt_number: attemptNumber,
                    error_message: syncError.message
                  });
              } else {
                // ✅ POST-OPERATION VERIFICATION
                console.log(`[auto-maintenance] ⏳ Waiting 2 seconds to verify sync status...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const { data: verifyData, error: verifyError } = await supabase.functions.invoke('check-and-sync-all', {
                  body: { agentId: agent.id, autoFix: false }
                });
                
                const verifyStatuses = verifyData?.statuses || [];
                const isActuallySynced = !verifyStatuses.some((s: any) => s.status !== 'synced');
                
                if (isActuallySynced) {
                  console.log(`[auto-maintenance] ✅ VERIFIED: Agent ${agent.name} successfully synced`);
                  
                  await supabase
                    .from('maintenance_operation_details')
                    .insert({
                      execution_log_id: execLogId,
                      operation_type: 'sync_agent',
                      target_id: agent.id,
                      target_name: agent.name,
                      status: 'success',
                      attempt_number: attemptNumber
                    });

                  agentsSynced++;
                } else {
                  console.log(`[auto-maintenance] ❌ VERIFICATION FAILED: Agent ${agent.name} still has sync issues`);
                  
                  await supabase
                    .from('maintenance_operation_details')
                    .insert({
                      execution_log_id: execLogId,
                      operation_type: 'sync_agent',
                      target_id: agent.id,
                      target_name: agent.name,
                      status: 'retry_needed',
                      attempt_number: attemptNumber,
                      error_message: 'Post-verification failed: agent still has sync issues'
                    });
                }
              }
            }
          }
        } catch (err) {
          console.error(`[auto-maintenance] ❌ Exception checking agent ${agent.name}:`, err);
        }
      }
    } else {
      console.log('[auto-maintenance] ✅ No active agents found');
    }

    // 5. Aggiorna log di esecuzione
    const executionStatus = (documentsFailed > 0 || agentsSyncFailed > 0 || summariesFailed > 0) 
      ? 'partial_failure' 
      : 'success';

    await supabase
      .from('maintenance_execution_logs')
      .update({
        execution_completed_at: new Date().toISOString(),
        execution_status: executionStatus,
        documents_fixed: documentsFixed,
        documents_failed: documentsFailed,
        chunks_cleaned: chunksCleaned,
        agents_synced: agentsSynced,
        agents_sync_failed: agentsSyncFailed,
        details: {
          summaries_generated: summariesGenerated,
          summaries_failed: summariesFailed
        }
      })
      .eq('id', execLogId);

    console.log(`[auto-maintenance] ========== COMPLETED (${executionStatus}) ==========`);
    console.log(`[auto-maintenance] Summary: ${documentsFixed} docs fixed, ${documentsFailed} docs failed, ${chunksCleaned} chunks cleaned, ${agentsSynced} agents synced, ${agentsSyncFailed} agents failed, ${summariesGenerated} summaries generated, ${summariesFailed} summaries failed`);

    // 6. Pulizia log vecchi (> 7 giorni)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('maintenance_execution_logs')
      .delete()
      .lt('execution_started_at', sevenDaysAgo);

    return new Response(
      JSON.stringify({
        success: true,
        status: executionStatus,
        summary: {
          documentsFixed,
          documentsFailed,
          chunksCleaned,
          agentsSynced,
          agentsSyncFailed
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[auto-maintenance] ❌ Fatal error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (execLogId) {
      await supabase
        .from('maintenance_execution_logs')
        .update({
          execution_completed_at: new Date().toISOString(),
          execution_status: 'error',
          error_message: errorMessage
        })
        .eq('id', execLogId);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
