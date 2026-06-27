import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Brand } from "@/components/Brand";
import { useAuth } from "@/hooks/useAuth";
import { supabaseConfigurado } from "@/lib/supabase";

export default function Login() {
  const { signIn, session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);

  const destino = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  // Si ya hay sesión, fuera del login.
  if (!loading && session) return <Navigate to={destino} replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const { error } = await signIn(email.trim(), password);
    setEnviando(false);
    if (error) {
      toast.error("No se pudo iniciar sesión", { description: error });
      return;
    }
    toast.success("Bienvenido");
    navigate(destino, { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="items-center text-center">
          <Brand size="lg" vertical className="mb-2" />
          <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
        </CardHeader>
        <CardContent>
          {!supabaseConfigurado && (
            <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              Falta configurar las credenciales de Supabase en <code>.env.local</code>.
            </p>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              Ingresar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
