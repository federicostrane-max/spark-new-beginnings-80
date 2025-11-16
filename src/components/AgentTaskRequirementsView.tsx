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

interface BibliographicReference {
  title: string;
  authors: string[] | null;
  type: string;
  importance: 'critical' | 'supporting';
  version_specific: boolean;
  abbreviation?: string | null;
}

interface TaskRequirements {
  id: string;
  agent_id: string;
  theoretical_concepts: string[];
  operational_concepts: string[];
  procedural_knowledge: string[];
  explicit_rules: string[];
  domain_vocabulary: string[];
  bibliographic_references: { [key: string]: BibliographicReference };
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

  // Edit state - v6 schema
  const [editedTheoretical, setEditedTheoretical] = useState<string[]>([]);
  const [editedOperational, setEditedOperational] = useState<string[]>([]);
  const [editedProcedural, setEditedProcedural] = useState<string[]>([]);
  const [editedRules, setEditedRules] = useState<string[]>([]);
  const [editedVocabulary, setEditedVocabulary] = useState<string[]>([]);
  const [editedBibliographic, setEditedBibliographic] = useState<{ [key: string]: BibliographicReference }>({});

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
          theoretical_concepts: data.theoretical_concepts || [],
          operational_concepts: data.operational_concepts || [],
          procedural_knowledge: data.procedural_knowledge || [],
          explicit_rules: data.explicit_rules || [],
          domain_vocabulary: data.domain_vocabulary || [],
          bibliographic_references: (data.bibliographic_references as any) || {}
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
      setEditedTheoretical([...requirements.theoretical_concepts]);
      setEditedOperational([...requirements.operational_concepts]);
      setEditedProcedural([...requirements.procedural_knowledge]);
      setEditedRules([...requirements.explicit_rules]);
      setEditedVocabulary([...requirements.domain_vocabulary]);
      setEditedBibliographic({ ...requirements.bibliographic_references });
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
          theoretical_concepts: editedTheoretical.filter(t => t?.trim()),
          operational_concepts: editedOperational.filter(o => o?.trim()),
          procedural_knowledge: editedProcedural.filter(p => p?.trim()),
          explicit_rules: editedRules.filter(r => r?.trim()),
          domain_vocabulary: editedVocabulary.filter(v => v?.trim()),
          bibliographic_references: editedBibliographic
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

  // Generic array handlers
  const handleArrayChange = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    setter(prev => {
      const newArr = [...prev];
      newArr[index] = value;
      return newArr;
    });
    setHasUnsavedChanges(true);
  };

  const handleArrayAdd = (setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => [...prev, ""]);
    setHasUnsavedChanges(true);
  };

  const handleArrayRemove = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number
  ) => {
    setter(prev => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  };

  // Render functions - Simple string arrays
  const renderStringArrayEdit = (
    items: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    label: string
  ) => (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2">
          <Input
            value={item}
            onChange={(e) => handleArrayChange(setter, idx, e.target.value)}
            placeholder={label}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleArrayRemove(setter, idx)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleArrayAdd(setter)}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Aggiungi {label}
      </Button>
    </div>
  );

  const renderStringArrayReadOnly = (items: string[]) => (
    <ul className="list-disc list-inside space-y-1">
      {items.map((item, idx) => (
        <li key={idx} className="text-sm text-muted-foreground">
          {item}
        </li>
      ))}
    </ul>
  );

  // This old handler is no longer used since we handle changes inline now
  // Keeping for reference, but all onChange handlers are now inline in renderBibliographicEdit

  const renderBibliographicEdit = () => {
    const refs = Object.entries(editedBibliographic);
    return (
      <div className="space-y-4">
        {refs.map(([key, ref], idx) => (
          <div key={key} className="border rounded-lg p-3 space-y-2">
            <div className="flex gap-2">
              <Input
                value={ref.title}
                onChange={(e) => {
                  setEditedBibliographic(prev => ({
                    ...prev,
                    [key]: { ...prev[key], title: e.target.value }
                  }));
                  setHasUnsavedChanges(true);
                }}
                placeholder="Titolo"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditedBibliographic(prev => {
                    const newObj = { ...prev };
                    delete newObj[key];
                    return newObj;
                  });
                  setHasUnsavedChanges(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              value={ref.authors?.join(', ') || ''}
              onChange={(e) => {
                setEditedBibliographic(prev => ({
                  ...prev,
                  [key]: { 
                    ...prev[key], 
                    authors: e.target.value ? e.target.value.split(',').map(a => a.trim()) : null 
                  }
                }));
                setHasUnsavedChanges(true);
              }}
              placeholder="Autori separati da virgola (opzionale)"
            />
            <Input
              value={ref.abbreviation || ''}
              onChange={(e) => {
                setEditedBibliographic(prev => ({
                  ...prev,
                  [key]: { ...prev[key], abbreviation: e.target.value || null }
                }));
                setHasUnsavedChanges(true);
              }}
              placeholder="Abbreviazione citazione (es: [THEORY])"
            />
            <div className="flex gap-2">
              <Input
                value={ref.type}
                onChange={(e) => {
                  setEditedBibliographic(prev => ({
                    ...prev,
                    [key]: { ...prev[key], type: e.target.value }
                  }));
                  setHasUnsavedChanges(true);
                }}
                placeholder="Tipo (es: manuale, linee guida)"
                className="flex-1"
              />
              <select
                value={ref.importance}
                onChange={(e) => {
                  setEditedBibliographic(prev => ({
                    ...prev,
                    [key]: { ...prev[key], importance: e.target.value as 'critical' | 'supporting' }
                  }));
                  setHasUnsavedChanges(true);
                }}
                className="border rounded px-2"
              >
                <option value="critical">Critico</option>
                <option value="supporting">Supporto</option>
              </select>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newKey = `ref_${Date.now()}`;
            setEditedBibliographic(prev => ({
              ...prev,
              [newKey]: {
                title: '',
                authors: null,
                type: '',
                importance: 'supporting',
                version_specific: false,
                abbreviation: null
              }
            }));
            setHasUnsavedChanges(true);
          }}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Aggiungi Riferimento
        </Button>
      </div>
    );
  };

  const renderBibliographicReadOnly = (items: { [key: string]: BibliographicReference }) => {
    if (!items || typeof items !== 'object' || Object.keys(items).length === 0) {
      return <p className="text-sm text-muted-foreground">Nessun riferimento bibliografico trovato</p>;
    }

    // Validate that refs actually contains valid reference objects
    const validRefs = Object.entries(items).filter(([_, ref]) => 
      ref && typeof ref === 'object' && ref.title
    );

    if (validRefs.length === 0) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-destructive">⚠️ Struttura non valida: i riferimenti bibliografici non sono nel formato corretto</p>
          <p className="text-xs text-muted-foreground">Ri-estrai i task requirements per risolvere il problema</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {validRefs.map(([key, ref]) => (
          <div key={key} className="border-l-2 border-primary pl-3 py-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm flex-1">{ref.title}</p>
              {ref.abbreviation && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {ref.abbreviation}
                </Badge>
              )}
            </div>
            {ref.authors && ref.authors.length > 0 && (
              <p className="text-xs text-muted-foreground">{ref.authors.join(', ')}</p>
            )}
            <div className="flex gap-2 mt-1">
              <Badge variant="outline" className="text-xs">{ref.type}</Badge>
              <Badge
                variant={ref.importance === 'critical' ? 'default' : 'secondary'}
                className="text-xs"
              >
                {ref.importance}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!requirements) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Nessun requirement estratto per questo agente.
          </p>
          <Button onClick={handleExtract} disabled={extracting}>
            {extracting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Estrazione in corso...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Estrai Requirements
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Task Requirements</h3>
            {isOutOfSync() && (
              <Badge variant="destructive">Out of Sync</Badge>
            )}
          </div>
          <div className="flex gap-2">
            {editMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditMode}
                  disabled={saving}
                >
                  <X className="mr-2 h-4 w-4" />
                  Annulla
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvataggio...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Salva
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExtract}
                  disabled={extracting}
                >
                  {extracting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Estrazione...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Ri-estrai
                    </>
                  )}
                </Button>
                <Button size="sm" onClick={() => setEditMode(true)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Modifica
                </Button>
              </>
            )}
            <ExtractionPromptDialog />
          </div>
        </div>

        <Accordion type="multiple" className="w-full" defaultValue={["theoretical", "operational"]}>
          <AccordionItem value="theoretical">
            <AccordionTrigger>
              Concetti Teorici ({requirements.theoretical_concepts.length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderStringArrayEdit(editedTheoretical, setEditedTheoretical, "Concetto teorico")
                : renderStringArrayReadOnly(requirements.theoretical_concepts)}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="operational">
            <AccordionTrigger>
              Concetti Operativi ({requirements.operational_concepts.length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderStringArrayEdit(editedOperational, setEditedOperational, "Concetto operativo")
                : renderStringArrayReadOnly(requirements.operational_concepts)}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="procedural">
            <AccordionTrigger>
              Conoscenza Procedurale ({requirements.procedural_knowledge.length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderStringArrayEdit(editedProcedural, setEditedProcedural, "Procedura")
                : renderStringArrayReadOnly(requirements.procedural_knowledge)}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="rules">
            <AccordionTrigger>
              Regole Esplicite ({requirements.explicit_rules.length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderStringArrayEdit(editedRules, setEditedRules, "Regola")
                : renderStringArrayReadOnly(requirements.explicit_rules)}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="vocabulary">
            <AccordionTrigger>
              Vocabolario di Dominio ({requirements.domain_vocabulary.length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderStringArrayEdit(editedVocabulary, setEditedVocabulary, "Termine")
                : renderStringArrayReadOnly(requirements.domain_vocabulary)}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="bibliographic">
            <AccordionTrigger>
              Riferimenti Bibliografici ({Object.keys(requirements.bibliographic_references).length})
            </AccordionTrigger>
            <AccordionContent>
              {editMode
                ? renderBibliographicEdit()
                : renderBibliographicReadOnly(requirements.bibliographic_references)}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Estratto il: {new Date(requirements.extracted_at).toLocaleString()}</p>
          <p>Modello: {requirements.extraction_model}</p>
        </div>
      </div>

      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifiche non salvate</AlertDialogTitle>
            <AlertDialogDescription>
              Hai modifiche non salvate. Vuoi scartarle?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={toggleEditMode}>
              Scarta modifiche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
