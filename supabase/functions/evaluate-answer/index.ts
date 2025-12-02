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
  suiteCategory?: string;
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
    const { question, agentResponse, groundTruths, suiteCategory }: EvaluationRequest = await req.json();
    
    if (!question || !agentResponse || !groundTruths || groundTruths.length === 0) {
      throw new Error('Missing required fields: question, agentResponse, groundTruths');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Determine if this is a reasoning-based suite (narrative, science)
    const isReasoningSuite = suiteCategory === 'narrative' || suiteCategory === 'science';

    // FACTUAL_JUDGE_PROMPT: For precise factual data (dates, numbers, names)
    const FACTUAL_JUDGE_PROMPT = `You are an impartial judge evaluating QA accuracy.

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
7. NUMERICAL TOLERANCE: For financial values, accept answers that represent the same underlying number:
   - More precise answers are CORRECT: "$8.738B" is correct when ground truth is "$8.70B"
   - Unit conversions are equivalent: "$1,577 million" = "$1.577 billion"
   - Rounding differences under 1% are acceptable when ground truth appears rounded (ends in .0, .00, etc.)

Respond ONLY with valid JSON:
{"correct": boolean, "reason": "brief explanation in italiano"}`;

    // REASONING_JUDGE_PROMPT: For deep understanding and synthesis (narrative, science)
    const REASONING_JUDGE_PROMPT = `You are evaluating REASONING-BASED answers that require synthesis and understanding.

Question: ${question}
Ground Truth: ${groundTruths.join(' OR ')}
Candidate Answer: ${agentResponse}

EVALUATION RULES FOR REASONING:
1. The answer does NOT need to match word-for-word with Ground Truth
2. Evaluate if the Candidate captures the CORE CONCEPT and CORRECT LOGIC expressed in Ground Truth
3. Accept paraphrasing, different wording, and additional context that enriches the answer
4. If Ground Truth says "Yes, because X" and Candidate says "The method works due to X" → CORRECT
5. Focus on: understanding of narrative/scientific concepts, cause-effect relationships, logical inference
6. Minor factual errors in peripheral details are acceptable if the main reasoning is sound
7. Semantic equivalence is more important than lexical similarity
8. If the candidate demonstrates understanding of the underlying concept even with different expression → CORRECT

Respond ONLY with valid JSON:
{"correct": boolean, "reason": "brief explanation in italiano"}`;

    // Select appropriate prompt based on suite category
    const JUDGE_PROMPT = isReasoningSuite ? REASONING_JUDGE_PROMPT : FACTUAL_JUDGE_PROMPT;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a precise evaluation judge. Always respond with valid JSON only.' },
          { role: 'user', content: JUDGE_PROMPT }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`Lovable AI error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Lovable AI response data:', JSON.stringify(data, null, 2));
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid response structure from Lovable AI:', data);
      throw new Error('Invalid response structure from LLM');
    }
    
    const judgeResponse = data.choices[0].message.content;
    console.log('Judge response content:', judgeResponse);
    
    if (!judgeResponse || judgeResponse.trim() === '') {
      console.error('Empty response from LLM judge');
      throw new Error('Empty response from LLM judge');
    }
    
    const cleanedJson = cleanJsonString(judgeResponse);
    console.log('Cleaned JSON:', cleanedJson);
    
    if (!cleanedJson || cleanedJson.trim() === '') {
      console.error('cleanJsonString returned empty string');
      throw new Error('Failed to extract JSON from LLM response');
    }
    
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
