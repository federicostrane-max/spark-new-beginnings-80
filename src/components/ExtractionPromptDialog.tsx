import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileCode2, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ExtractionPromptDialogProps {
  children?: React.ReactNode;
}

export const ExtractionPromptDialog = ({ children }: ExtractionPromptDialogProps) => {
  const FILTER_VERSION = 'v5';
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <FileCode2 className="mr-2 h-4 w-4" />
            Vedi Prompt di Estrazione
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Prompt di Estrazione Task Requirements
            <Badge variant="secondary">{FILTER_VERSION}</Badge>
          </DialogTitle>
          <DialogDescription>
            Questo è il prompt interno usato dall'AI per estrarre i requisiti dal system prompt dell'agente
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[70vh] pr-4">
          <div className="space-y-6">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Questo prompt definisce come l'AI analizza il system prompt per estrarre Core Concepts, Procedural Knowledge, Decision Patterns e Domain Vocabulary.
                La versione <strong>{FILTER_VERSION}</strong> include regole aggiornate per ignorare termini presenti solo negli esempi di dialogo.
              </AlertDescription>
            </Alert>

            <div className="space-y-4 text-sm">
              <section className="space-y-2">
                <h3 className="font-semibold text-base">📋 Prompt Completo</h3>
                <div className="bg-muted p-4 rounded-lg space-y-4 font-mono text-xs">
                  <p className="text-foreground">
                    You are an AI assistant analyzing an agent's system prompt to extract its TASK REQUIREMENTS.
                  </p>
                  
                  <p className="text-foreground">
                    Your job is to extract ONLY what is explicitly written in the prompt, nothing more.
                  </p>

                  <div className="space-y-2">
                    <p className="text-foreground font-semibold">Extract these 4 categories:</p>
                    
                    <div className="pl-4 space-y-3">
                      <div>
                        <p className="text-primary font-semibold">1. Core Concepts (array of strings)</p>
                        <p className="text-muted-foreground">Main topics the agent must understand (e.g., "Che Guevara biography", "Cuban Revolution")</p>
                      </div>
                      
                      <div>
                        <p className="text-primary font-semibold">2. Procedural Knowledge (array of strings)</p>
                        <p className="text-muted-foreground">Step-by-step processes or "how to" instructions (e.g., "Verify claim in biography", "Extract publication date")</p>
                      </div>
                      
                      <div>
                        <p className="text-primary font-semibold">3. Decision Patterns (array of strings)</p>
                        <p className="text-muted-foreground">Rules for behavior/judgments (e.g., "If no citation found, respond 'Info not available'", "Reject questions outside biography scope")</p>
                      </div>
                      
                      <div>
                        <p className="text-primary font-semibold">4. Domain Vocabulary (array of strings)</p>
                        <p className="text-muted-foreground">Specific terms/names the agent MUST know to perform its task</p>
                        
                        <div className="mt-2 space-y-2 pl-4 border-l-2 border-yellow-500">
                          <p className="text-yellow-600 font-semibold">⚠️ STRICT RULES:</p>
                          <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                            <li>Extract ONLY proper nouns, technical terms, or specialized vocabulary mentioned in the main prompt</li>
                            <li>DO NOT extract generic words (e.g., "context", "knowledge", "document")</li>
                            <li>DO NOT infer domain knowledge not written in the prompt</li>
                            <li className="text-red-600 font-semibold">
                              ❌ CRITICAL: Terms that appear ONLY in dialogue examples (User/Assistant exchanges)
                              <ul className="list-circle pl-4 mt-1">
                                <li>Examples show HOW to behave, not WHAT to know</li>
                                <li>If a term appears only in example questions/answers, DO NOT extract it</li>
                                <li>Extract only if the term is mentioned in the main prompt instructions</li>
                              </ul>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="font-semibold text-foreground">What to NEVER Extract:</p>
                    <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                      <li>Generic terms (e.g., "context", "citation", "knowledge base", "source")</li>
                      <li>Terms you think are relevant but are not written in the prompt</li>
                      <li>Background knowledge about the domain not mentioned in prompt</li>
                      <li className="text-red-600 font-semibold">❌ CRITICAL: Terms that appear ONLY in dialogue examples (User/Assistant exchanges)</li>
                    </ul>
                  </div>

                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="font-semibold text-foreground">📚 Examples:</p>
                    
                    <div className="space-y-3 pl-4">
                      <div>
                        <p className="text-primary">Example 1:</p>
                        <p className="text-muted-foreground">Prompt: "Answer about Che Guevara's life. Focus on events from 1928 to 1967. Reference only the biography text."</p>
                        <p className="text-green-600">✅ CORRECT: ["Che Guevara", "1928", "1967"]</p>
                        <p className="text-red-600">❌ WRONG: ["Argentina", "Bolivia", "guerrilla warfare"] (not explicitly in prompt)</p>
                      </div>

                      <div className="border-l-2 border-red-500 pl-3">
                        <p className="text-primary">Example 2 (NEW in v5):</p>
                        <p className="text-muted-foreground">Prompt: "Answer about Che Guevara's life. Example: User: 'Tell me about World War II.' Assistant: 'I can only answer about Che Guevara.'"</p>
                        <p className="text-green-600">✅ CORRECT: ["Che Guevara"]</p>
                        <p className="text-red-600 font-semibold">❌ WRONG: ["World War II"] (appears only in example dialogue showing off-topic handling)</p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-foreground">Return as array of strings</p>
                    <p className="text-muted-foreground mt-2">
                      Respond ONLY with valid JSON matching this structure:
                    </p>
                    <pre className="bg-background p-3 rounded mt-2 text-xs overflow-x-auto">
{`{
  "core_concepts": ["concept1", "concept2"],
  "procedural_knowledge": ["step1", "step2"],
  "decision_patterns": ["rule1", "rule2"],
  "domain_vocabulary": ["term1", "term2"]
}`}
                    </pre>
                  </div>
                </div>
              </section>

              <section className="space-y-2 border-t pt-4">
                <h3 className="font-semibold text-base">🔄 Storia Versioni</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Badge variant="secondary">v5</Badge>
                    <div className="text-xs text-muted-foreground">
                      <strong>Corrente:</strong> Aggiunta regola critica per ignorare termini presenti solo negli esempi di dialogo User/Assistant
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge variant="outline">v4</Badge>
                    <div className="text-xs text-muted-foreground">
                      Precedente: Filtri base per Domain Vocabulary senza gestione esempi
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-2 border-t pt-4">
                <h3 className="font-semibold text-base">💡 Perché Questo Prompt?</h3>
                <ul className="list-disc pl-6 text-xs text-muted-foreground space-y-1">
                  <li>Gli esempi di dialogo servono a mostrare <strong>Decision Patterns</strong> (come comportarsi), non a definire il dominio</li>
                  <li>Se "World War II" compare solo in un esempio di domanda da rifiutare, NON è parte del dominio dell'agente</li>
                  <li>L'allineamento della knowledge base ora ignora termini presenti solo negli esempi, evitando falsi negativi</li>
                  <li>Il <strong>Domain Vocabulary</strong> include solo termini che l'agente deve effettivamente conoscere per svolgere il suo compito</li>
                </ul>
              </section>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
