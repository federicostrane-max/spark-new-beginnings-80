import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
}

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (agent: Agent) => void;
}

export const CreateAgentModal = ({ open, onOpenChange, onSuccess }: CreateAgentModalProps) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [loading, setLoading] = useState(false);

  // Auto-generate slug from name
  useEffect(() => {
    if (name) {
      const autoSlug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      setSlug(autoSlug);
    }
  }, [name]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setDescription("");
      setSystemPrompt("");
      setAvatar("🤖");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!name || name.length < 3) {
      toast({ title: "Name too short", description: "Agent name must be at least 3 characters", variant: "destructive" });
      return;
    }
    
    if (!slug) {
      toast({ title: "Slug required", variant: "destructive" });
      return;
    }

    // Check slug uniqueness
    const { data: existing } = await supabase
      .from("agents")
      .select("id")
      .eq("slug", slug)
      .single();
    
    if (existing) {
      toast({ title: "Slug already exists", description: "Please choose a different slug", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agents")
        .insert({
          name,
          slug,
          description,
          system_prompt: systemPrompt,
          avatar,
          active: true
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Success", description: "Agent created successfully!" });
      onSuccess(data);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating agent:", error);
      toast({ title: "Error", description: error.message || "Failed to create agent", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <Label htmlFor="name">Agent Name *</Label>
            <Input 
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing Guru"
              required
            />
          </div>

          {/* Slug */}
          <div>
            <Label htmlFor="slug">Slug (URL identifier) *</Label>
            <Input 
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="marketing-guru"
              pattern="[a-z0-9-]+"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Lowercase, no spaces (auto-generated from name)
            </p>
          </div>

          {/* Avatar */}
          <div>
            <Label htmlFor="avatar">Avatar (Emoji)</Label>
            <Input 
              id="avatar"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="🤖"
              maxLength={4}
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea 
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this agent specializes in..."
              rows={3}
            />
          </div>

          {/* System Prompt */}
          <div>
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea 
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a marketing expert specialized in..."
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Define the agent's personality, expertise, and behavior
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Agent"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};