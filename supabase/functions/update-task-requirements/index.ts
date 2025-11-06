import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, core_concepts, procedural_knowledge, decision_patterns, domain_vocabulary } = await req.json();

    console.log("Updating task requirements for agent:", agentId);

    // Validation
    if (!agentId) {
      throw new Error("agentId is required");
    }

    if (!Array.isArray(core_concepts) || 
        !Array.isArray(procedural_knowledge) || 
        !Array.isArray(decision_patterns) || 
        !Array.isArray(domain_vocabulary)) {
      throw new Error("All requirement fields must be arrays");
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current requirements to preserve hash and extraction info
    const { data: current, error: fetchError } = await supabase
      .from("agent_task_requirements")
      .select("*")
      .eq("agent_id", agentId)
      .order("extracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching current requirements:", fetchError);
      throw fetchError;
    }

    if (!current) {
      throw new Error("No existing requirements found for this agent");
    }

    // Update requirements
    const { data, error: updateError } = await supabase
      .from("agent_task_requirements")
      .update({
        core_concepts,
        procedural_knowledge,
        decision_patterns,
        domain_vocabulary,
        updated_at: new Date().toISOString()
      })
      .eq("id", current.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating requirements:", updateError);
      throw updateError;
    }

    console.log("Successfully updated task requirements");

    return new Response(
      JSON.stringify({ success: true, data }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in update-task-requirements:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});