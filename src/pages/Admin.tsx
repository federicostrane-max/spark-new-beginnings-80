import { AdminPanel } from "@/components/AdminPanel";

const Admin = () => {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Gestione e manutenzione del sistema
          </p>
        </div>
        
        <AdminPanel />
      </div>
    </div>
  );
};

export default Admin;
