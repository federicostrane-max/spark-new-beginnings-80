import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";

export default function DocumentPool() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Torna alla Chat
          </Button>
          
          <div>
            <h1 className="text-3xl font-bold">Pool Documenti Condivisi</h1>
            <p className="text-muted-foreground mt-2">
              Gestisci i documenti validati e assegnali ai tuoi agenti
            </p>
          </div>
        </div>

        <DocumentPoolTable />
      </div>
    </div>
  );
}
