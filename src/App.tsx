import { ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { TTSProvider } from "@/contexts/TTSContext";
import { useAuth } from "@/hooks/useAuth";
import MultiAgentConsultant from "./pages/MultiAgentConsultant";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";



const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }
  
  return user ? <>{children}</> : <Navigate to="/auth" replace />;
};

const App = () => {
  const [queryClient] = useState(() => new QueryClient());
  
  return (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <TTSProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <MultiAgentConsultant />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </TTSProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
  );
};

export default App;
