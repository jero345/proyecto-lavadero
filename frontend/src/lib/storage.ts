import { supabase } from "@/lib/supabase";

export const BUCKET_FOTOS = "ordenes-fotos";

/**
 * Sube una foto de orden al bucket privado y devuelve la ruta (path) guardable
 * en ordenes.foto_url. Para mostrarla luego se usa urlFirmadaFoto().
 */
export async function subirFotoOrden(file: File, userId: string): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Genera una URL firmada temporal para mostrar una foto del bucket privado. */
export async function urlFirmadaFoto(path: string, segundos = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .createSignedUrl(path, segundos);
  if (error) return null;
  return data.signedUrl;
}
