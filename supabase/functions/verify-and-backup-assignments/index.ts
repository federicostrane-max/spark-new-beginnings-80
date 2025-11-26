import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackupRequest {
  backupName?: string;
  backupDescription?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: BackupRequest = await req.json();
    const backupName = body.backupName || `Backup ${new Date().toISOString()}`;
    const backupDescription = body.backupDescription || 'Automatic backup of problematic documents';

    console.log(`[verify-and-backup] Starting backup process: ${backupName}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    let userId = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    // ========================================
    // STEP 1: Identify problematic documents
    // ========================================
    console.log('[verify-and-backup] Fetching problematic documents...');
    
    const { data: problematicDocs, error: docsError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, text_length, processing_status, validation_status')
      .eq('processing_status', 'ready_for_assignment')
      .is('full_text', null)
      .not('text_length', 'is', null)
      .order('file_name');

    if (docsError) throw docsError;

    console.log(`[verify-and-backup] Found ${problematicDocs?.length || 0} problematic documents`);

    if (!problematicDocs || problematicDocs.length === 0) {
      return new Response(
        JSON.stringify({
          summary: {
            totalDocuments: 0,
            filesFound: 0,
            filesMissing: 0,
            totalAssignments: 0
          },
          message: 'No problematic documents found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================
    // STEP 2: Verify file existence in storage
    // ========================================
    const filesFound: any[] = [];
    const filesMissing: any[] = [];
    const backupData: any[] = [];

    for (const doc of problematicDocs) {
      console.log(`[verify-and-backup] Checking document: ${doc.file_name}`);
      
      // Try to find file in storage buckets
      let fileExists = false;
      let fileSize = 0;
      
      // Check shared-pool-uploads bucket first
      try {
        const { data: listData, error: listError } = await supabase.storage
          .from('shared-pool-uploads')
          .list('', { 
            search: doc.file_name,
            limit: 1
          });

        if (!listError && listData && listData.length > 0) {
          fileExists = true;
          fileSize = listData[0].metadata?.size || 0;
          console.log(`[verify-and-backup] ✅ File found in shared-pool-uploads: ${doc.file_name}`);
        }
      } catch (err) {
        console.log(`[verify-and-backup] Error checking shared-pool-uploads:`, err);
      }

      // If not found, check knowledge-pdfs bucket
      if (!fileExists) {
        try {
          const { data: listData, error: listError } = await supabase.storage
            .from('knowledge-pdfs')
            .list('', { 
              search: doc.file_name,
              limit: 1
            });

          if (!listError && listData && listData.length > 0) {
            fileExists = true;
            fileSize = listData[0].metadata?.size || 0;
            console.log(`[verify-and-backup] ✅ File found in knowledge-pdfs: ${doc.file_name}`);
          }
        } catch (err) {
          console.log(`[verify-and-backup] Error checking knowledge-pdfs:`, err);
        }
      }

      // ========================================
      // STEP 3: Fetch assignments for this document
      // ========================================
      const { data: assignments, error: assignError } = await supabase
        .from('agent_document_links')
        .select(`
          id,
          agent_id,
          assignment_type,
          confidence_score,
          assigned_by,
          created_at,
          sync_status,
          sync_error,
          agents!inner(id, name)
        `)
        .eq('document_id', doc.id);

      if (assignError) {
        console.error(`[verify-and-backup] Error fetching assignments for ${doc.file_name}:`, assignError);
        continue;
      }

      const formattedAssignments = (assignments || []).map(a => ({
        link_id: a.id,
        agent_id: a.agent_id,
        agent_name: (a.agents as any).name,
        assignment_type: a.assignment_type,
        confidence_score: a.confidence_score,
        assigned_by: a.assigned_by,
        created_at: a.created_at,
        sync_status: a.sync_status,
        sync_error: a.sync_error
      }));

      const docData = {
        document_id: doc.id,
        file_name: doc.file_name,
        file_path: doc.file_path,
        text_length: doc.text_length,
        processing_status: doc.processing_status,
        validation_status: doc.validation_status,
        file_exists: fileExists,
        file_size_bytes: fileSize,
        assignments: formattedAssignments
      };

      backupData.push(docData);

      if (fileExists) {
        filesFound.push(docData);
      } else {
        filesMissing.push(docData);
      }
    }

    // ========================================
    // STEP 4: Save backup to database
    // ========================================
    console.log('[verify-and-backup] Saving backup to database...');
    
    const totalAssignments = backupData.reduce((sum, doc) => sum + doc.assignments.length, 0);

    const { data: backup, error: backupError } = await supabase
      .from('document_assignment_backups')
      .insert({
        backup_name: backupName,
        backup_description: backupDescription,
        created_by: userId,
        assignments: { documents: backupData },
        documents_count: problematicDocs.length,
        assignments_count: totalAssignments,
        files_found: filesFound.length,
        files_missing: filesMissing.length
      })
      .select()
      .single();

    if (backupError) throw backupError;

    console.log('[verify-and-backup] ✅ Backup saved successfully');

    // ========================================
    // STEP 5: Return detailed report
    // ========================================
    return new Response(
      JSON.stringify({
        success: true,
        backupId: backup.id,
        backupName: backup.backup_name,
        summary: {
          totalDocuments: problematicDocs.length,
          filesFound: filesFound.length,
          filesMissing: filesMissing.length,
          totalAssignments
        },
        filesFound: filesFound.map(f => ({
          document_id: f.document_id,
          file_name: f.file_name,
          file_size_bytes: f.file_size_bytes,
          agents: f.assignments.map((a: any) => a.agent_name)
        })),
        filesMissing: filesMissing.map(f => ({
          document_id: f.document_id,
          file_name: f.file_name,
          agents: f.assignments.map((a: any) => a.agent_name)
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[verify-and-backup] Error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.toString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
