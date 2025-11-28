import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, CheckCircle2, XCircle, FileText, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface QAPair {
  question: {
    it: string;
    en: string;
  };
  answer: string;
}

interface DocAnnotation {
  doc_id: string;
  pdf_file: string;
  image_file: string;
  qa_pairs: QAPair[];
}

export default function DocVQATest() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [annotations, setAnnotations] = useState<DocAnnotation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/docvqa-annotations.json')
      .then(res => res.json())
      .then(data => {
        setAnnotations(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading annotations:', err);
        toast({
          title: "Errore",
          description: "Impossibile caricare il file annotations.json",
          variant: "destructive"
        });
        setLoading(false);
      });
  }, [toast]);

  const copyToClipboard = (text: string, pdfFile: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "✅ Domanda copiata",
      description: `Domanda per ${pdfFile} copiata negli appunti`
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Caricamento dataset DocVQA...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Indietro
          </Button>
          <div>
            <h1 className="text-3xl font-bold">DocVQA Test Dataset</h1>
            <p className="text-muted-foreground mt-1">
              {annotations.length} documenti con domande e risposte per testare Pipeline A
            </p>
          </div>
        </div>
      </div>

      {/* Stats Card */}
      <Card>
        <CardHeader>
          <CardTitle>📊 Statistiche Dataset</CardTitle>
          <CardDescription>
            Panoramica del dataset DocVQA per il test della knowledge base
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{annotations.length} documenti PDF</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Ogni documento ha 1 domanda con risposta ground-truth
            </span>
          </div>
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm font-medium mb-2">📝 Come usare questo dataset:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Carica i PDF corrispondenti nel Pool Documenti (Pipeline A)</li>
              <li>Assegna i documenti a un agente</li>
              <li>Copia la domanda dalla tabella sotto (click sull'icona Copia)</li>
              <li>Chiedi all'agente e confronta la risposta con quella attesa</li>
            </ol>
          </div>
          <div className="mt-4">
            <Button 
              onClick={() => navigate('/benchmark')}
              className="w-full gap-2"
              size="lg"
            >
              <PlayCircle className="h-5 w-5" />
              🧪 Avvia Benchmark Automatico sui 20 Documenti
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Questions Table */}
      <Card>
        <CardHeader>
          <CardTitle>🔍 Domande e Risposte Ground-Truth</CardTitle>
          <CardDescription>
            Clicca sull'icona copia per copiare la domanda negli appunti
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">PDF File</TableHead>
                  <TableHead>Domanda (IT)</TableHead>
                  <TableHead>Risposta Attesa</TableHead>
                  <TableHead className="w-[80px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {annotations.map((doc) => (
                  doc.qa_pairs.map((qa, idx) => (
                    <TableRow key={`${doc.doc_id}-${idx}`}>
                      <TableCell className="font-mono text-xs">
                        {doc.pdf_file}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-md">
                          <p className="text-sm">{qa.question.it}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            EN: {qa.question.en}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono">
                          {qa.answer}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(qa.question.it, doc.pdf_file)}
                          className="gap-2"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="text-yellow-600 dark:text-yellow-400">
            ⚠️ Note Importanti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>1. Upload dei PDF:</strong> I file PDF devono essere caricati manualmente 
            nel Pool Documenti. I nomi file sono: doc_0000.pdf, doc_0001.pdf, ... doc_0019.pdf
          </p>
          <p>
            <strong>2. Pipeline A Richiesta:</strong> Assicurati di usare Pipeline A per 
            processare questi documenti (non Pipeline B), poiché contengono testo e immagini
          </p>
          <p>
            <strong>3. Semantic Search:</strong> Le domande testano la capacità dell'agente 
            di recuperare informazioni specifiche (date, nomi, numeri) dai documenti
          </p>
          <p>
            <strong>4. Citazioni Richieste:</strong> L'agente dovrebbe citare la fonte 
            "[Da: doc_XXXX.pdf, Excerpt N]" quando risponde
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
