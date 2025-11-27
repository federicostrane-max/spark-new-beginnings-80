import { ReactNode, useState, lazy, Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { TTSProvider } from "@/contexts/TTSContext";
import { useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";

// Lazy load all page components
const MultiAgentConsultant = lazy(() => import("./pages/MultiAgentConsultant"));
const DocumentPool = lazy(() => import("./pages/DocumentPool"));
const Presentation = lazy(() => import("./pages/Presentation"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));
const UpdateChePrompt = lazy(() => import("./pages/UpdateChePrompt"));
const UpdateDocumentFinderPrompt = lazy(() => import("./pages/UpdateDocumentFinderPrompt"));
const DocVQATest = lazy(() => import("./pages/DocVQATest"));
const NotFound = lazy(() => import("./pages/NotFound"));



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
            <ErrorBoundary>
              <Suspense 
                fallback={
                  <div className="flex h-screen items-center justify-center bg-background">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Caricamento...</p>
                    </div>
                  </div>
                }
              >
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
                  <Route
                    path="/documents"
                    element={
                      <ProtectedRoute>
                        <DocumentPool />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/presentation"
                    element={
                      <ProtectedRoute>
                        <Presentation />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute>
                        <Admin />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/update-che-prompt"
                    element={
                      <ProtectedRoute>
                        <UpdateChePrompt />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/update-document-finder-prompt"
                    element={
                      <ProtectedRoute>
                        <UpdateDocumentFinderPrompt />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/docvqa-test"
                    element={
                      <ProtectedRoute>
                        <DocVQATest />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </TooltipProvider>
        </TTSProvider>
      </AuthProvider>
      <Toaster />
    </BrowserRouter>
  </QueryClientProvider>
  );
};

export default App;
