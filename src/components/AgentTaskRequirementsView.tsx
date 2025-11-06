import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Edit, Save, X, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import crypto from "crypto-js";

interface RequirementItem {
  concept?: string;
  term?: string;
  pattern?: string;
  procedure?: string;
  importance: string;
}

interface TaskRequirements {
  id: string;
  agent_id: string;
  core_concepts: RequirementItem[];
  procedural_knowledge: RequirementItem[];
  decision_patterns: RequirementItem[];
  domain_vocabulary: RequirementItem[];
  system_prompt_hash: string;
  extracted_at: string;
  extraction_model: string;
}

interface AgentTaskRequirementsViewProps {
  agentId: string;
  systemPrompt: string;
}

export const AgentTaskRequirementsView = ({ agentId, systemPrompt }: AgentTaskRequirementsViewProps) => {
  const [requirements, setRequirements] = useState<TaskRequirements | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Edit state
  const [editedCoreConcepts, setEditedCoreConcepts] = useState<RequirementItem[]>([]);
  const [editedProceduralKnowledge, setEditedProceduralKnowledge] = useState<RequirementItem[]>([]);
  const [editedDecisionPatterns, setEditedDecisionPatterns] = useState<RequirementItem[]>([]);
  const [editedDomainVocabulary, setEditedDomainVocabulary] = useState<RequirementItem[]>([]);

  useEffect(() => {
    fetchRequirements();
  }, [agentId]);

  const fetchRequirements = async () => {
    try {
      const { data, error } = await supabase
        .from("agent_task_requirements")
        .select("*")
        .eq("agent_id", agentId)
        .order("extracted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setRequirements({
          ...data,
          core_concepts: data.core_concepts as unknown as RequirementItem[],
          procedural_knowledge: data.procedural_knowledge as unknown as RequirementItem[],
          decision_patterns: data.decision_patterns as unknown as RequirementItem[],
          domain_vocabulary: data.domain_vocabulary as unknown as RequirementItem[]
        });
      }
    } catch (error) {
      console.error("Error fetching task requirements:", error);
      toast.error("Errore nel caricamento dei requirements");
    } finally {
      setLoading(false);
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const { error } = await supabase.functions.invoke("extract-task-requirements", {
        body: { agentId }
      });

      if (error) throw error;

      toast.success("Estrazione completata!");
      await fetchRequirements();
    } catch (error) {
      console.error("Error extracting requirements:", error);
      toast.error("Errore nell'estrazione dei requirements");
    } finally {
      setExtracting(false);
    }
  };

  const calculateHash = (prompt: string): string => {
    return crypto.SHA256(prompt).toString();
  };

  const isOutOfSync = (): boolean => {
    if (!requirements || !systemPrompt) return false;
    const currentHash = calculateHash(systemPrompt);
    return currentHash !== requirements.system_prompt_hash;
  };

  const handleEditMode = () => {
    if (editMode && hasUnsavedChanges) {
      setShowExitDialog(true);
    } else {
      toggleEditMode();
    }
  };

  const toggleEditMode = () => {
    if (!editMode && requirements) {
      // Entering edit mode
      setEditedCoreConcepts([...requirements.core_concepts]);
      setEditedProceduralKnowledge([...requirements.procedural_knowledge]);
      setEditedDecisionPatterns([...requirements.decision_patterns]);
      setEditedDomainVocabulary([...requirements.domain_vocabulary]);
    }
    setEditMode(!editMode);
    setHasUnsavedChanges(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("update-task-requirements", {
        body: {
          agentId,
          core_concepts: editedCoreConcepts.filter(c => (c.concept || c.term || c.pattern || c.procedure)?.trim()),
          procedural_knowledge: editedProceduralKnowledge.filter(c => (c.concept || c.term || c.pattern || c.procedure)?.trim()),
          decision_patterns: editedDecisionPatterns.filter(c => (c.concept || c.term || c.pattern || c.procedure)?.trim()),
          domain_vocabulary: editedDomainVocabulary.filter(c => (c.concept || c.term || c.pattern || c.procedure)?.trim())
        }
      });

      if (error) throw error;

      toast.success("Requirements aggiornati!");
      await fetchRequirements();
      setEditMode(false);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error("Error saving requirements:", error);
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const handleItemChange = (
    setter: React.Dispatch<React.SetStateAction<RequirementItem[]>>,
    index: number,
    field: 'concept' | 'term' | 'pattern' | 'procedure' | 'importance',
    value: string
  ) => {
    setter(prev => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], [field]: value };
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleAddItem = (setter: React.Dispatch<React.SetStateAction<RequirementItem[]>>, type: 'concept' | 'term' | 'pattern' | 'procedure') => {
    setter(prev => [...prev, { [type]: "", importance: "medium" } as RequirementItem]);
    setHasUnsavedChanges(true);
  };

  const handleRemoveItem = (
    setter: React.Dispatch<React.SetStateAction<RequirementItem[]>>,
    index: number
  ) => {
    setter(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const renderEditableList = (
    items: RequirementItem[],
    setter: React.Dispatch<React.SetStateAction<RequirementItem[]>>,
    title: string,
    fieldName: 'concept' | 'term' | 'pattern' | 'procedure'
  ) => {
    return (
      <div className="space-y-2">
        {items.map((item, idx) => {
          const mainValue = item.concept || item.term || item.pattern || item.procedure || "";
          return (
            <div key={idx} className="flex gap-2">
              <Input
                value={mainValue}
                onChange={(e) => handleItemChange(setter, idx, fieldName, e.target.value)}
                placeholder={`${title} ${idx + 1}`}
                className="flex-1"
              />
              <Input
                value={item.importance || "medium"}
                onChange={(e) => handleItemChange(setter, idx, 'importance', e.target.value)}
                placeholder="Importance"
                className="w-24"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveItem(setter, idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAddItem(setter, fieldName)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Aggiungi
        </Button>
      </div>
    );
  };

  const renderReadOnlyList = (items: RequirementItem[]) => {
    return (
      <ul className="list-disc list-inside space-y-1">
        {items.map((item, idx) => {
          const mainValue = item.concept || item.term || item.pattern || item.procedure || "";
          return (
            <li key={idx} className="text-sm text-muted-foreground">
              {mainValue} <Badge variant="outline" className="ml-2 text-xs">{item.importance}</Badge>
            </li>
          );
        })}
      </ul>
    );
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Card>
    );
  }

  if (!requirements) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Nessun requirement estratto. Avvia l'estrazione per analizzare il prompt dell'agente.
          </p>
          <Button onClick={handleExtract} disabled={extracting}>
            {extracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Estrai Requirements
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Task Requirements</h3>
              {isOutOfSync() ? (
                <Badge variant="destructive">Out of sync</Badge>
              ) : (
                <Badge variant="secondary">
                  {editMode ? "Manually Edited" : "Up to date"}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              {!editMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExtract}
                    disabled={extracting}
                  >
                    {extracting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Re-extract
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleEditMode}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </>
              )}
              {editMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditMode}
                    disabled={saving}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges}
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Accordion */}
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="core-concepts">
              <AccordionTrigger>
                Core Concepts ({editMode ? editedCoreConcepts.length : requirements.core_concepts.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderEditableList(editedCoreConcepts, setEditedCoreConcepts, "Concept", "concept")
                  : renderReadOnlyList(requirements.core_concepts)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="procedural">
              <AccordionTrigger>
                Procedural Knowledge ({editMode ? editedProceduralKnowledge.length : requirements.procedural_knowledge.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderEditableList(editedProceduralKnowledge, setEditedProceduralKnowledge, "Procedure", "procedure")
                  : renderReadOnlyList(requirements.procedural_knowledge)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="decision">
              <AccordionTrigger>
                Decision Patterns ({editMode ? editedDecisionPatterns.length : requirements.decision_patterns.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderEditableList(editedDecisionPatterns, setEditedDecisionPatterns, "Pattern", "pattern")
                  : renderReadOnlyList(requirements.decision_patterns)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="vocabulary">
              <AccordionTrigger>
                Domain Vocabulary ({editMode ? editedDomainVocabulary.length : requirements.domain_vocabulary.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderEditableList(editedDomainVocabulary, setEditedDomainVocabulary, "Term", "term")
                  : renderReadOnlyList(requirements.domain_vocabulary)}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground pt-2 border-t">
            <p>Estratto: {new Date(requirements.extracted_at).toLocaleString()}</p>
            <p>Model: {requirements.extraction_model}</p>
          </div>
        </div>
      </Card>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifiche non salvate</AlertDialogTitle>
            <AlertDialogDescription>
              Hai modifiche non salvate. Vuoi uscire dalla modalità edit senza salvare?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                toggleEditMode();
                setShowExitDialog(false);
              }}
            >
              Esci senza salvare
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};