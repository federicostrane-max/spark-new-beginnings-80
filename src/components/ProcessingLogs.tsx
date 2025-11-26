import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const ProcessingLogs = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Elaborazione</CardTitle>
        <CardDescription>
          Sistema legacy rimosso - log non disponibili
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          La funzionalità di processing logs è stata disabilitata con la rimozione del sistema legacy.
        </p>
      </CardContent>
    </Card>
  );
};
