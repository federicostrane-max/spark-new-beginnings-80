import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Detects if a response is incomplete based on various indicators
 */
function isResponseIncomplete(content: string): boolean {
  const trimmed = content.trim();
  
  // Check 1: Ends with incomplete code block
  const codeBlockStarts = (trimmed.match(/```/g) || []).length;
  if (codeBlockStarts % 2 !== 0) {
    return true;
  }
  
  // Check 2: Ends with incomplete Python/JS code patterns
  const incompleteCodePatterns = [
    /for\s+\w+\s+in\s+\w+:\s*$/,
    /def\s+\w+\([^)]*\):\s*$/,
    /if\s+[^:]+:\s*$/,
    /class\s+\w+.*:\s*$/,
    /\{\s*$/,
    /function\s+\w+\([^)]*\)\s*\{\s*$/,
    /=>\s*\{\s*$/,
  ];
  
  for (const pattern of incompleteCodePatterns) {
    if (pattern.test(trimmed)) return true;
  }
  
  // Check 3: Ends with incomplete sentence indicators
  const incompleteSentencePatterns = [
    /,\s*$/,
    /:\s*$/,
    /\(\s*$/,
    /\[\s*$/,
  ];
  
  const lastLine = trimmed.split('\n').slice(-1)[0];
  if (!lastLine.includes('```')) {
    for (const pattern of incompleteSentencePatterns) {
      if (pattern.test(trimmed)) return true;
    }
  }
  
  // Check 4: No proper ending punctuation
  const endsWithProperPunctuation = /[.!?]\s*$/.test(trimmed);
  const hasMinimumLength = content.length > 100;
  
  if (hasMinimumLength && !endsWithProperPunctuation && !trimmed.endsWith('```')) {
    return true;
  }
  
  return false;
}

/**
 * Calls DeepSeek for continuation
 */
async function callDeepSeekForContinuation(
  currentContent: string,
  messages: Message[],
  systemPrompt: string,
  deepseekApiKey: string,
  requestId: string
): Promise<string> {
  console.log(`🔄 [CONTINUE-${requestId}] Requesting continuation from DeepSeek...`);
  
  const continuationMessages: Message[] = [
    ...messages,
    { role: 'assistant', content: currentContent },
    { 
      role: 'user', 
      content: 'Please continue exactly from where you left off. Do not repeat what you already wrote, just continue the response.' 
    }
  ];
  
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...continuationMessages
      ],
      temperature: 0.7,
      max_tokens: 8000,
      stream: false
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const continuation = data.choices?.[0]?.message?.content || '';
  
  console.log(`✅ [CONTINUE-${requestId}] DeepSeek continuation received: ${continuation.length} chars`);
  return continuation;
}

/**
 * Calls Claude for continuation
 */
async function callClaudeForContinuation(
  currentContent: string,
  messages: Message[],
  systemPrompt: string,
  anthropicApiKey: string,
  requestId: string
): Promise<string> {
  console.log(`🔄 [CONTINUE-${requestId}] Requesting continuation from Claude...`);
  
  const continuationMessages = [
    ...messages.map(m => ({
      role: m.role,
      content: m.content
    })),
    { role: 'assistant', content: currentContent },
    { 
      role: 'user', 
      content: 'Please continue exactly from where you left off. Do not repeat what you already wrote, just continue the response.' 
    }
  ];
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250514',
      system: systemPrompt,
      messages: continuationMessages,
      max_tokens: 8192,
      temperature: 0.7,
      stream: false
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const continuation = data.content?.[0]?.text || '';
  
  console.log(`✅ [CONTINUE-${requestId}] Claude continuation received: ${continuation.length} chars`);
  return continuation;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      messageId, 
      conversationId,
      currentContent, 
      agentId, 
      messages, 
      systemPrompt,
      requestId,
      llmProvider  // NEW: Support for different providers
    } = await req.json();

    console.log(`🚀 [CONTINUE-${requestId}] Starting async continuation for message ${messageId}`);
    console.log(`📊 [CONTINUE-${requestId}] Provider: ${llmProvider || 'deepseek'}, Current length: ${currentContent.length} chars`);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

    const provider = llmProvider || 'deepseek';
    
    // Validate we have the right API key
    if (provider === 'anthropic' && !ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    if (provider === 'deepseek' && !DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let fullContent = currentContent;
    let continuationAttempts = 0;
    const maxAttempts = 3;

    // Try up to 3 continuations
    while (continuationAttempts < maxAttempts && isResponseIncomplete(fullContent)) {
      try {
        console.log(`🔄 [CONTINUE-${requestId}] Attempt ${continuationAttempts + 1}/${maxAttempts} using ${provider}`);
        
        let continuation = '';
        
        if (provider === 'anthropic') {
          continuation = await callClaudeForContinuation(
            fullContent,
            messages,
            systemPrompt,
            ANTHROPIC_API_KEY!,
            requestId
          );
        } else {
          continuation = await callDeepSeekForContinuation(
            fullContent,
            messages,
            systemPrompt,
            DEEPSEEK_API_KEY!,
            requestId
          );
        }

        fullContent += continuation;
        continuationAttempts++;

        console.log(`📈 [CONTINUE-${requestId}] New total length: ${fullContent.length} chars`);

        // Update DB immediately after each continuation
        const { error: updateError } = await supabase
          .from('agent_messages')
          .update({ content: fullContent })
          .eq('id', messageId);

        if (updateError) {
          console.error(`❌ [CONTINUE-${requestId}] DB update failed:`, updateError);
          throw updateError;
        }

        console.log(`✅ [CONTINUE-${requestId}] Continuation ${continuationAttempts} completed and saved`);

      } catch (error) {
        console.error(`❌ [CONTINUE-${requestId}] Continuation ${continuationAttempts + 1} failed:`, error);
        break;
      }
    }

    const stillIncomplete = isResponseIncomplete(fullContent);
    
    if (stillIncomplete) {
      console.log(`⚠️ [CONTINUE-${requestId}] Response still incomplete after ${continuationAttempts} attempts`);
    } else {
      console.log(`✅ [CONTINUE-${requestId}] Response is now complete!`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        continuations: continuationAttempts,
        finalLength: fullContent.length,
        isComplete: !stillIncomplete
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('❌ [CONTINUE] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
