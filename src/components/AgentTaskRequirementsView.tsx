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
import { ExtractionPromptDialog } from "@/components/ExtractionPromptDialog";

interface CoreConceptItem {
  concept: string;
  importance: string;
}

interface ProceduralKnowledgeItem {
  process: string;
  steps: string[];
}

interface DecisionPatternItem {
  pattern: string;
  criteria: string[];
}

type DomainVocabularyItem = string;

interface TaskRequirements {
  id: string;
  agent_id: string;
  core_concepts: CoreConceptItem[];
  procedural_knowledge: ProceduralKnowledgeItem[];
  decision_patterns: DecisionPatternItem[];
  domain_vocabulary: DomainVocabularyItem[];
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
  const [editedCoreConcepts, setEditedCoreConcepts] = useState<CoreConceptItem[]>([]);
  const [editedProceduralKnowledge, setEditedProceduralKnowledge] = useState<ProceduralKnowledgeItem[]>([]);
  const [editedDecisionPatterns, setEditedDecisionPatterns] = useState<DecisionPatternItem[]>([]);
  const [editedDomainVocabulary, setEditedDomainVocabulary] = useState<DomainVocabularyItem[]>([]);

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
          core_concepts: data.core_concepts as unknown as CoreConceptItem[],
          procedural_knowledge: data.procedural_knowledge as unknown as ProceduralKnowledgeItem[],
          decision_patterns: data.decision_patterns as unknown as DecisionPatternItem[],
          domain_vocabulary: data.domain_vocabulary as unknown as DomainVocabularyItem[]
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

  const hasCorruptedData = (): boolean => {
    if (!requirements) return false;
    
    // Check procedural knowledge structure
    if (!Array.isArray(requirements.procedural_knowledge)) return true;
    const hasInvalidProcedural = requirements.procedural_knowledge.some(
      item => !item?.process || !Array.isArray(item.steps)
    );
    
    // Check decision patterns structure
    if (!Array.isArray(requirements.decision_patterns)) return true;
    const hasInvalidDecision = requirements.decision_patterns.some(
      item => !item?.pattern || !Array.isArray(item.criteria)
    );
    
    return hasInvalidProcedural || hasInvalidDecision;
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
          core_concepts: editedCoreConcepts.filter(c => c.concept?.trim()),
          procedural_knowledge: editedProceduralKnowledge.filter(p => p.process?.trim()),
          decision_patterns: editedDecisionPatterns.filter(d => d.pattern?.trim()),
          domain_vocabulary: editedDomainVocabulary.filter(v => v?.trim())
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

  // Core Concepts handlers
  const handleCoreConceptChange = (index: number, field: keyof CoreConceptItem, value: string) => {
    setEditedCoreConcepts(prev => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], [field]: value };
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  // Procedural Knowledge handlers
  const handleProceduralChange = (index: number, field: 'process', value: string) => {
    setEditedProceduralKnowledge(prev => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], [field]: value };
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleStepChange = (procIndex: number, stepIndex: number, value: string) => {
    setEditedProceduralKnowledge(prev => {
      const newArr = [...prev];
      newArr[procIndex].steps[stepIndex] = value;
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleAddStep = (procIndex: number) => {
    setEditedProceduralKnowledge(prev => {
      const newArr = [...prev];
      newArr[procIndex].steps.push("");
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleRemoveStep = (procIndex: number, stepIndex: number) => {
    setEditedProceduralKnowledge(prev => {
      const newArr = [...prev];
      newArr[procIndex].steps = newArr[procIndex].steps.filter((_, i) => i !== stepIndex);
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  // Decision Pattern handlers
  const handleDecisionChange = (index: number, field: 'pattern', value: string) => {
    setEditedDecisionPatterns(prev => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], [field]: value };
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleCriterionChange = (patIndex: number, critIndex: number, value: string) => {
    setEditedDecisionPatterns(prev => {
      const newArr = [...prev];
      newArr[patIndex].criteria[critIndex] = value;
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleAddCriterion = (patIndex: number) => {
    setEditedDecisionPatterns(prev => {
      const newArr = [...prev];
      newArr[patIndex].criteria.push("");
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleRemoveCriterion = (patIndex: number, critIndex: number) => {
    setEditedDecisionPatterns(prev => {
      const newArr = [...prev];
      newArr[patIndex].criteria = newArr[patIndex].criteria.filter((_, i) => i !== critIndex);
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  // Domain Vocabulary handlers
  const handleVocabularyChange = (index: number, value: string) => {
    setEditedDomainVocabulary(prev => {
      const newArr = [...prev];
      newArr[index] = value;
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  // Generic handlers
  const handleRemoveCoreConcept = (index: number) => {
    setEditedCoreConcepts(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const handleRemoveProcedural = (index: number) => {
    setEditedProceduralKnowledge(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const handleRemoveDecision = (index: number) => {
    setEditedDecisionPatterns(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const handleRemoveVocabulary = (index: number) => {
    setEditedDomainVocabulary(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  const handleAddCoreConcept = () => {
    setEditedCoreConcepts(prev => [...prev, { concept: "", importance: "medium" }]);
    setHasUnsavedChanges(true);
  };

  const handleAddProcedural = () => {
    setEditedProceduralKnowledge(prev => [...prev, { process: "", steps: [""] }]);
    setHasUnsavedChanges(true);
  };

  const handleAddDecision = () => {
    setEditedDecisionPatterns(prev => [...prev, { pattern: "", criteria: [""] }]);
    setHasUnsavedChanges(true);
  };

  const handleAddVocabulary = () => {
    setEditedDomainVocabulary(prev => [...prev, ""]);
    setHasUnsavedChanges(true);
  };

  // Render functions
  const renderCoreConceptsEdit = () => (
    <div className="space-y-3">
      {editedCoreConcepts.map((item, idx) => (
        <div key={idx} className="flex gap-2">
          <Input
            value={item.concept}
            onChange={(e) => handleCoreConceptChange(idx, 'concept', e.target.value)}
            placeholder="Concept"
            className="flex-1"
          />
          <Input
            value={item.importance}
            onChange={(e) => handleCoreConceptChange(idx, 'importance', e.target.value)}
            placeholder="Importance"
            className="w-28"
          />
          <Button variant="ghost" size="icon" onClick={() => handleRemoveCoreConcept(idx)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={handleAddCoreConcept} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Aggiungi Concept
      </Button>
    </div>
  );

  const renderProceduralEdit = () => (
    <div className="space-y-4">
      {editedProceduralKnowledge.map((item, idx) => (
        <div key={idx} className="border rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <Input
              value={item.process}
              onChange={(e) => handleProceduralChange(idx, 'process', e.target.value)}
              placeholder="Process name"
              className="flex-1"
            />
            <Button variant="ghost" size="icon" onClick={() => handleRemoveProcedural(idx)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="ml-4 space-y-2">
            <p className="text-xs text-muted-foreground">Steps:</p>
            {item.steps.map((step, stepIdx) => (
              <div key={stepIdx} className="flex gap-2">
                <Input
                  value={step}
                  onChange={(e) => handleStepChange(idx, stepIdx, e.target.value)}
                  placeholder={`Step ${stepIdx + 1}`}
                  className="flex-1"
                />
                <Button variant="ghost" size="icon" onClick={() => handleRemoveStep(idx, stepIdx)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => handleAddStep(idx)}>
              <Plus className="h-4 w-4 mr-2" />
              Aggiungi Step
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={handleAddProcedural} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Aggiungi Process
      </Button>
    </div>
  );

  const renderDecisionEdit = () => (
    <div className="space-y-4">
      {editedDecisionPatterns.map((item, idx) => (
        <div key={idx} className="border rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <Input
              value={item.pattern}
              onChange={(e) => handleDecisionChange(idx, 'pattern', e.target.value)}
              placeholder="Decision pattern"
              className="flex-1"
            />
            <Button variant="ghost" size="icon" onClick={() => handleRemoveDecision(idx)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="ml-4 space-y-2">
            <p className="text-xs text-muted-foreground">Criteria:</p>
            {item.criteria.map((crit, critIdx) => (
              <div key={critIdx} className="flex gap-2">
                <Input
                  value={crit}
                  onChange={(e) => handleCriterionChange(idx, critIdx, e.target.value)}
                  placeholder={`Criterion ${critIdx + 1}`}
                  className="flex-1"
                />
                <Button variant="ghost" size="icon" onClick={() => handleRemoveCriterion(idx, critIdx)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => handleAddCriterion(idx)}>
              <Plus className="h-4 w-4 mr-2" />
              Aggiungi Criterion
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={handleAddDecision} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Aggiungi Pattern
      </Button>
    </div>
  );

  const renderVocabularyEdit = () => (
    <div className="space-y-2">
      {editedDomainVocabulary.map((term, idx) => (
        <div key={idx} className="flex gap-2">
          <Input
            value={term}
            onChange={(e) => handleVocabularyChange(idx, e.target.value)}
            placeholder="Term"
            className="flex-1"
          />
          <Button variant="ghost" size="icon" onClick={() => handleRemoveVocabulary(idx)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={handleAddVocabulary} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Aggiungi Term
      </Button>
    </div>
  );

  const renderCoreConceptsReadOnly = (items: CoreConceptItem[]) => (
    <ul className="list-disc list-inside space-y-1">
      {items.map((item, idx) => (
        <li key={idx} className="text-sm text-muted-foreground">
          {item.concept}
          <Badge variant="outline" className="ml-2 text-xs">{item.importance}</Badge>
        </li>
      ))}
    </ul>
  );

  const renderProceduralReadOnly = (items: ProceduralKnowledgeItem[]) => {
    // Validate data structure
    if (!Array.isArray(items)) {
      return <p className="text-sm text-destructive">⚠️ Dati non validi. Ri-estrai i requirements.</p>;
    }
    
    return (
      <div className="space-y-3">
        {items.map((item, idx) => {
          // Skip invalid items
          if (!item?.process || !Array.isArray(item.steps)) {
            return (
              <div key={idx} className="text-sm text-destructive">
                ⚠️ Voce {idx + 1} malformata
              </div>
            );
          }
          
          return (
            <div key={idx}>
              <p className="text-sm font-medium text-foreground">{item.process}</p>
              <ul className="list-decimal list-inside ml-4 mt-1 space-y-0.5">
                {item.steps.map((step, stepIdx) => (
                  <li key={stepIdx} className="text-sm text-muted-foreground">{step}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDecisionReadOnly = (items: DecisionPatternItem[]) => {
    // Validate data structure
    if (!Array.isArray(items)) {
      return <p className="text-sm text-destructive">⚠️ Dati non validi. Ri-estrai i requirements.</p>;
    }
    
    return (
      <div className="space-y-3">
        {items.map((item, idx) => {
          // Skip invalid items
          if (!item?.pattern || !Array.isArray(item.criteria)) {
            return (
              <div key={idx} className="text-sm text-destructive">
                ⚠️ Voce {idx + 1} malformata
              </div>
            );
          }
          
          return (
            <div key={idx}>
              <p className="text-sm font-medium text-foreground">{item.pattern}</p>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                {item.criteria.map((crit, critIdx) => (
                  <li key={critIdx} className="text-sm text-muted-foreground">{crit}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  };

  const renderVocabularyReadOnly = (items: DomainVocabularyItem[]) => (
    <ul className="list-disc list-inside space-y-1">
      {items.map((term, idx) => (
        <li key={idx} className="text-sm text-muted-foreground">{term}</li>
      ))}
    </ul>
  );

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
              {hasCorruptedData() ? (
                <Badge variant="destructive">⚠️ Dati Corrotti</Badge>
              ) : isOutOfSync() ? (
                <Badge variant="destructive">Out of sync</Badge>
              ) : (
                <Badge variant="secondary">
                  {editMode ? "Manually Edited" : "Up to date"}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <ExtractionPromptDialog />
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
                  ? renderCoreConceptsEdit()
                  : renderCoreConceptsReadOnly(requirements.core_concepts)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="procedural">
              <AccordionTrigger>
                Procedural Knowledge ({editMode ? editedProceduralKnowledge.length : requirements.procedural_knowledge.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderProceduralEdit()
                  : renderProceduralReadOnly(requirements.procedural_knowledge)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="decision">
              <AccordionTrigger>
                Decision Patterns ({editMode ? editedDecisionPatterns.length : requirements.decision_patterns.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderDecisionEdit()
                  : renderDecisionReadOnly(requirements.decision_patterns)}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="vocabulary">
              <AccordionTrigger>
                Domain Vocabulary ({editMode ? editedDomainVocabulary.length : requirements.domain_vocabulary.length})
              </AccordionTrigger>
              <AccordionContent>
                {editMode
                  ? renderVocabularyEdit()
                  : renderVocabularyReadOnly(requirements.domain_vocabulary)}
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