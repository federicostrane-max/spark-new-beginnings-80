import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvaluationRequest {
  question: string;
  agentResponse: string;
  groundTruths: string[];
}

interface EvaluationResult {
  correct: boolean;
  reason: string;
}

function cleanJsonString(text: string): string {
  text = text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.substring(startIdx, endIdx + 1);
  }
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, agentResponse, groundTruths }: EvaluationRequest = await req.json();
    
    if (!question || !agentResponse || !groundTruths || groundTruths.length === 0) {
      throw new Error('Missing required fields: question, agentResponse, groundTruths');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const JUDGE_PROMPT = `You are an impartial judge evaluating QA accuracy.

Question: ${question}
Ground Truth(s): ${groundTruths.join(' OR ')}
Candidate Answer: ${agentResponse}

EVALUATION RULES:
1. Is the candidate's answer FACTUALLY CORRECT with respect to the Ground Truth?
2. Ignore style, formatting, and verbosity - focus ONLY on factual content
3. A response that CONTAINS the correct information IS correct
4. Be FLEXIBLE with date formats: DD/MM/YY, MM/DD/YY, YYYY-MM-DD are equivalent
   (e.g., "1/8/93" = "01/08/1993" = "January 8, 1993" = "8 gennaio 1993")
5. Accept SEMANTIC EQUIVALENCE for names and identifiers:
   (e.g., "T.F. Riehl" = "Riehl, T.F." = "Riehl T.F." = "Thomas F. Riehl")
6. Numbers can have different formatting: "499150498" = "499-150-498" = "499 150 498"

Respond ONLY with valid JSON:
{"correct": boolean, "reason": "brief explanation in italiano"}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          { role: 'system', content: 'You are a precise evaluation judge. Always respond with valid JSON only.' },
          { role: 'user', content: JUDGE_PROMPT }
        ],
        temperature: 0.1,
        max_completion_tokens: 300
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`Lovable AI error: ${response.status}`);
    }

    const data = await response.json();
    const judgeResponse = data.choices[0].message.content;
    
    const cleanedJson = cleanJsonString(judgeResponse);
    const evaluation: EvaluationResult = JSON.parse(cleanedJson);

    if (typeof evaluation.correct !== 'boolean' || !evaluation.reason) {
      throw new Error('Invalid evaluation format from LLM');
    }

    return new Response(JSON.stringify(evaluation), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in evaluate-answer:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error),
        correct: false,
        reason: 'Errore durante la valutazione'
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
