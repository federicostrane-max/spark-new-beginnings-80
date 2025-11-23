import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AirtopRequest {
  action: 'create_session' | 'navigate' | 'execute_task' | 'close_session';
  sessionId?: string;
  url?: string;
  task?: string;
  prompt?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const airtopApiKey = Deno.env.get('AIRTOP_API_KEY');
    if (!airtopApiKey) {
      throw new Error('AIRTOP_API_KEY not configured');
    }

    const { action, sessionId, url, task, prompt }: AirtopRequest = await req.json();
    
    console.log(`[airtop-browser-automation] Action: ${action}`);

    const baseUrl = 'https://api.airtop.ai/v1';

    switch (action) {
      case 'create_session': {
        console.log('[airtop-browser-automation] Creating new browser session');
        
        const response = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${airtopApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            configuration: {
              timeoutMinutes: 30,
            }
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[airtop-browser-automation] Create session error:', errorText);
          throw new Error(`Failed to create session: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('[airtop-browser-automation] Session created:', data.data?.id);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            sessionId: data.data?.id,
            cdpUrl: data.data?.cdpWsUrl,
            message: 'Browser session created successfully'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'navigate': {
        if (!sessionId || !url) {
          throw new Error('sessionId and url are required for navigate action');
        }

        console.log(`[airtop-browser-automation] Navigating session ${sessionId} to ${url}`);
        
        const response = await fetch(`${baseUrl}/sessions/${sessionId}/windows`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${airtopApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: url,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[airtop-browser-automation] Navigate error:', errorText);
          throw new Error(`Failed to navigate: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            windowId: data.data?.id,
            message: `Navigated to ${url}`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'execute_task': {
        if (!sessionId || !prompt) {
          throw new Error('sessionId and prompt are required for execute_task action');
        }

        console.log(`[airtop-browser-automation] Executing task in session ${sessionId}`);
        
        // Use Airtop's AI agent to execute the task
        const response = await fetch(`${baseUrl}/sessions/${sessionId}/windows/agent`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${airtopApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: prompt,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[airtop-browser-automation] Execute task error:', errorText);
          throw new Error(`Failed to execute task: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            result: data,
            message: 'Task executed successfully'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'close_session': {
        if (!sessionId) {
          throw new Error('sessionId is required for close_session action');
        }

        console.log(`[airtop-browser-automation] Closing session ${sessionId}`);
        
        const response = await fetch(`${baseUrl}/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${airtopApiKey}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[airtop-browser-automation] Close session error:', errorText);
          throw new Error(`Failed to close session: ${response.status} ${errorText}`);
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Session closed successfully'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[airtop-browser-automation] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
