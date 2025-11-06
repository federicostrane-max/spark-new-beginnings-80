import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RefreshCw, Wrench, Trash2 } from 'lucide-react';

export const FixStuckDocuments = () => {
  const [fixing, setFixing] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const handleFix = async () => {
    setFixing(true);
    try {
      const { data, error } = await supabase.functions.invoke('fix-stuck-documents');

      if (error) throw error;

      if (data.fixed > 0) {
        toast.success(`Riparati ${data.fixed} documenti bloccati`, {
          description: data.triggered > 0 
            ? `Avviata elaborazione per ${data.triggered} documenti`
            : 'I documenti sono stati sbloccati'
        });
        
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast.info('Nessun documento bloccato trovato');
      }
    } catch (error) {
      console.error('Error fixing stuck documents:', error);
      toast.error('Errore durante la riparazione dei documenti');
    } finally {
      setFixing(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-chunks');

      if (error) throw error;

      if (data.deleted > 0) {
        toast.success(`Eliminati ${data.deleted} chunks orfani`, {
          description: `Da ${data.affectedDocuments} documenti e ${data.affectedAgents} agenti`
        });
        
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast.info('Nessun chunk orfano trovato');
      }
    } catch (error) {
      console.error('Error cleaning orphaned chunks:', error);
      toast.error('Errore durante la pulizia dei chunks');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        onClick={handleFix}
        disabled={fixing || cleaning}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        {fixing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Riparazione...
          </>
        ) : (
          <>
            <Wrench className="h-4 w-4" />
            Ripara Bloccati
          </>
        )}
      </Button>
      
      <Button
        onClick={handleCleanup}
        disabled={fixing || cleaning}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        {cleaning ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            Pulizia...
          </>
        ) : (
          <>
            <Trash2 className="h-4 w-4" />
            Pulisci Chunks Orfani
          </>
        )}
      </Button>
    </div>
  );
};
