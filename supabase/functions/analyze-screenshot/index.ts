import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeRequest {
  screenshot: string; // base64 encoded image
  question?: string; // Domanda specifica sull'interfaccia
  context?: string; // Contesto aggiuntivo (es. "Sto testando il login form")
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { screenshot, question, context }: AnalyzeRequest = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log("[analyze-screenshot] Analyzing with Lovable AI (vision model)...");

    const systemPrompt = `You are an expert UI/UX analyzer and QA tester. 
Analyze screenshots of web applications and provide detailed, actionable feedback.

Focus on:
- Visual bugs (misalignment, overflow, broken layouts)
- Accessibility issues (contrast, readable text)
- User experience problems
- Missing or broken UI elements
- Console errors visible in dev tools
- Responsiveness issues

Be specific and suggest concrete fixes.`;

    const userPrompt = context 
      ? `Context: ${context}\n\nQuestion: ${question || 'What issues do you see in this screenshot?'}`
      : question || 'Analyze this screenshot and report any visual bugs, UX issues, or errors you notice.';

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              { type: "text", text: userPrompt },
              { 
                type: "image_url", 
                image_url: { url: `data:image/png;base64,${screenshot}` }
              }
            ]
          }
        ],
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[analyze-screenshot] AI error:", errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your Lovable workspace." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const analysis = aiData.choices?.[0]?.message?.content || "No analysis generated.";

    console.log("[analyze-screenshot] Analysis complete");

    return new Response(
      JSON.stringify({ 
        success: true, 
        analysis,
        tokens_used: aiData.usage 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[analyze-screenshot] Error:", error);
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
