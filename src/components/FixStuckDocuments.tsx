import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RefreshCw, Wrench } from 'lucide-react';

export const FixStuckDocuments = () => {
  const [fixing, setFixing] = useState(false);

  const handleFix = async () => {
    setFixing(true);
    try {
      const { data, error } = await supabase.functions.invoke('fix-stuck-documents');

      if (error) throw error;

      if (data.fixed > 0) {
        toast.success(`✅ Riparati ${data.fixed} documenti bloccati`, {
          description: data.triggered > 0 
            ? `Avviata elaborazione per ${data.triggered} documenti`
            : 'I documenti sono stati sbloccati'
        });
        
        // Refresh the page after a short delay
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

  return (
    <Button
      onClick={handleFix}
      disabled={fixing}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      {fixing ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          Riparazione in corso...
        </>
      ) : (
        <>
          <Wrench className="h-4 w-4" />
          Ripara Documenti Bloccati
        </>
      )}
    </Button>
  );
};
