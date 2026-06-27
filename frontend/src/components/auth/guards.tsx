import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { Rol } from "@/types/database.types";

function PantallaCarga() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function PantallaPerfilNoDisponible() {
  const { refreshProfile, signOut } = useAuth();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <div>
        <p className="text-lg font-semibold">No se pudo cargar tu perfil</p>
        <p className="text-sm text-muted-foreground">
          Tu sesión es válida pero no encontramos tu perfil. Reintenta o vuelve a
          iniciar sesión.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void refreshProfile()}>
          Reintentar
        </Button>
        <Button onClick={() => void signOut()}>Cerrar sesión</Button>
      </div>
    </div>
  );
}

/** Exige sesión activa. Si no hay, redirige a /login. */
export function ProtectedRoute() {
  const { session, profile, profileError, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PantallaCarga />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  // Sesión válida pero sin perfil: no atrapar al usuario, ofrecer salida.
  if (!profile && profileError) return <PantallaPerfilNoDisponible />;
  if (!profile) return <PantallaCarga />;
  return <Outlet />;
}

/** Exige que el rol del usuario esté en `roles`. Si no, redirige al dashboard. */
export function RoleRoute({ roles }: { roles: Rol[] }) {
  const { profile, loading } = useAuth();

  if (loading) return <PantallaCarga />;
  if (!profile || !roles.includes(profile.rol)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
