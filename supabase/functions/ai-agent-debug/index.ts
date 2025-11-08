import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AgentDebugRequest {
  preview_url: string; // URL della preview Lovable
  task?: string; // Task da verificare (es. "Check if login form works")
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preview_url, task = "Perform a general visual inspection" }: AgentDebugRequest = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[ai-agent-debug] Starting autonomous debugging for: ${preview_url}`);
    console.log(`[ai-agent-debug] Task: ${task}`);

    // Step 1: Take screenshot
    console.log("[ai-agent-debug] Step 1: Taking screenshot...");
    const { data: screenshotData, error: screenshotError } = await supabase.functions.invoke('visual-debug', {
      body: { url: preview_url, action: 'screenshot' }
    });

    if (screenshotError || !screenshotData?.success) {
      throw new Error(`Screenshot failed: ${screenshotError?.message || screenshotData?.error}`);
    }

    const screenshot = screenshotData.screenshot;
    const consoleLogs = screenshotData.logs || [];
    const pageErrors = screenshotData.errors || [];

    console.log(`[ai-agent-debug] Screenshot captured. Logs: ${consoleLogs.length}, Errors: ${pageErrors.length}`);

    // Step 2: Analyze with AI
    console.log("[ai-agent-debug] Step 2: Analyzing with AI...");
    const analysisContext = `
Task: ${task}

Console Logs:
${consoleLogs.join('\n')}

Page Errors:
${pageErrors.join('\n')}

Please analyze the screenshot and provide:
1. Issues found (visual bugs, errors, UX problems)
2. Severity (critical/high/medium/low)
3. Suggested fixes (specific code changes if possible)
4. Next testing steps
`;

    const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-screenshot', {
      body: { 
        screenshot, 
        question: "What issues do you see? Provide actionable debugging steps.",
        context: analysisContext
      }
    });

    if (analysisError || !analysisData?.success) {
      throw new Error(`Analysis failed: ${analysisError?.message || analysisData?.error}`);
    }

    const analysis = analysisData.analysis;

    console.log("[ai-agent-debug] Analysis complete");

    // Step 3: Generate GitHub commit suggestion (se ci sono problemi)
    const hasIssues = pageErrors.length > 0 || analysis.toLowerCase().includes('error') || analysis.toLowerCase().includes('bug');

    let githubSuggestion = null;
    if (hasIssues) {
      githubSuggestion = {
        message: "🤖 AI Agent detected issues - suggested fixes",
        description: `Autonomous debugging session found issues:\n\n${analysis}\n\nConsole errors: ${pageErrors.length}\nLogs: ${consoleLogs.length}`,
        next_action: "Review the analysis and create a GitHub commit with fixes"
      };
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        preview_url,
        task,
        analysis,
        console_logs: consoleLogs,
        page_errors: pageErrors,
        screenshot_base64: screenshot,
        has_issues: hasIssues,
        github_suggestion: githubSuggestion,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[ai-agent-debug] Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
