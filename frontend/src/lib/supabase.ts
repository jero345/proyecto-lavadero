import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

// Lee las credenciales desde las variables de entorno de Vite.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Bandera para que la UI avise si falta configurar Supabase.
export const supabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigurado) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Todo en Uno] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local",
  );
}

/** Cliente Supabase (singleton) tipado con el schema de la base de datos. */
export const supabase = createClient<Database>(
  supabaseUrl ?? "http://localhost",
  supabaseAnonKey ?? "public-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
