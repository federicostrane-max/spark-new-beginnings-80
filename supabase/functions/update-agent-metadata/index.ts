import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type UpdateAgentMetadataBody = {
  agentId: string;
  name: string;
  description: string;
  llm_provider: string;
  ai_model: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";

    // Client for auth verification (uses anon key + incoming JWT)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const user = userData.user;

    const body = (await req.json()) as Partial<UpdateAgentMetadataBody>;
    const { agentId, name, description, llm_provider, ai_model } = body;

    if (!agentId || !name || !description || !llm_provider || !ai_model) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Service client for privileged update
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Fetch agent ownership
    const { data: agent, error: findError } = await serviceClient
      .from("agents")
      .select("id, user_id")
      .eq("id", agentId)
      .maybeSingle();

    if (findError) {
      throw new Error(findError.message);
    }

    if (!agent) {
      return new Response(
        JSON.stringify({ success: false, error: "Agent not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
      );
    }

    // Authorization: allow owner; allow claiming legacy agents with NULL user_id.
    const canEdit = agent.user_id === user.id || agent.user_id === null;
    if (!canEdit) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 },
      );
    }

    const patch: Record<string, unknown> = {
      name,
      description,
      llm_provider,
      ai_model,
    };

    // Claim legacy agent if needed
    if (agent.user_id === null) {
      patch.user_id = user.id;
    }

    const { data: updated, error: updateError } = await serviceClient
      .from("agents")
      .update(patch)
      .eq("id", agentId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated) {
      return new Response(
        JSON.stringify({ success: false, error: "Update returned no data" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    return new Response(
      JSON.stringify({ success: true, agent: updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: any) {
    console.error("[update-agent-metadata] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
