import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AutoPairingProvider } from "@/components/AutoPairingProvider";

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  // v10.3.0: AutoPairingProvider fa polling su localhost per auto-pairing Tool Server
  return user ? <AutoPairingProvider>{children}</AutoPairingProvider> : <Navigate to="/auth" replace />;
};
