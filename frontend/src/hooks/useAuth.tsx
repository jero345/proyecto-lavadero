import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import type { Profile, Rol } from "@/types/database.types";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  rol: Rol | null;
  loading: boolean;
  /** true si hay sesión pero no se pudo cargar el perfil (error o inexistente). */
  profileError: boolean;
  /** true si el rol es admin o super_admin. */
  isStaff: boolean;
  isSuperAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  const cargarProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Error cargando perfil:", error.message);
      setProfile(null);
      setProfileError(true);
      return;
    }
    setProfile(data);
    setProfileError(!data); // sin fila de perfil = error (usuario sin profile)
  }, []);

  useEffect(() => {
    let activo = true;

    // Sesión inicial.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return;
      setSession(data.session);
      if (data.session?.user) await cargarProfile(data.session.user.id);
      setLoading(false);
    });

    // Cambios de sesión (login/logout/refresh).
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!activo) return;
      setSession(newSession);
      if (newSession?.user) {
        await cargarProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [cargarProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await cargarProfile(session.user.id);
  }, [session, cargarProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      rol: profile?.rol ?? null,
      loading,
      profileError,
      isStaff: profile?.rol === "admin" || profile?.rol === "super_admin",
      isSuperAdmin: profile?.rol === "super_admin",
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, profileError, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
