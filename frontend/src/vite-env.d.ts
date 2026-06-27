/// <reference types="vite/client" />

// Tipado de las variables de entorno de Vite (autocompletado + seguridad de tipos).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
