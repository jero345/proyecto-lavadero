import { supabase } from "@/lib/supabase";
import type { Cliente } from "@/types/database.types";

/**
 * Búsqueda de clientes contra el SERVIDOR.
 *
 * No se puede traer la lista completa y filtrar en el navegador: la API corta
 * la respuesta en 1.000 filas y, pasado ese número, los clientes que quedaban
 * fuera no aparecían por ningún lado (migración 0043). La base busca por placa,
 * nombre o teléfono comparando sin espacios ni mayúsculas, así que "abc 123"
 * encuentra "ABC123".
 */
export async function buscarClientes(q: string, limite = 30): Promise<Cliente[]> {
  const { data, error } = await supabase.rpc("buscar_clientes", {
    p_q: q.trim(),
    p_limite: limite,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * El cliente que ya existe con esa placa (o con ese nombre, si no hay placa).
 * `null` = se puede crear. Son las mismas reglas de los índices únicos de la
 * migración 0018, pero preguntadas antes de intentar guardar.
 */
export async function buscarClienteDuplicado(
  placa: string,
  nombre: string,
  excluirId?: string,
): Promise<Cliente | null> {
  const { data, error } = await supabase.rpc("buscar_cliente_duplicado", {
    p_placa: placa.trim(),
    p_nombre: nombre.trim(),
    p_excluir: excluirId ?? null,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Igual que la anterior, pero lanzando el error listo para mostrar. */
export async function verificarClienteDuplicado(
  placa: string,
  nombre: string,
  excluirId?: string,
): Promise<void> {
  const duplicado = await buscarClienteDuplicado(placa, nombre, excluirId);
  if (duplicado) throw new Error(mensajeDuplicado(duplicado, placa, nombre));
}

/** "Ya existe un cliente con la placa ABC123 (Juan)". */
export function mensajeDuplicado(
  duplicado: Cliente | null,
  placa: string,
  nombre: string,
): string {
  const quien =
    duplicado && duplicado.nombre && duplicado.nombre !== duplicado.placa
      ? ` (${duplicado.nombre})`
      : "";
  return placa.trim()
    ? `Ya existe un cliente con la placa ${placa.trim().toUpperCase()}${quien}`
    : `Ya existe un cliente con el nombre "${nombre.trim()}"`;
}

/**
 * Traduce el error del índice único (código 23505) a algo que el dueño entienda.
 * Es la red de seguridad por si dos personas crean el mismo cliente a la vez.
 */
export function traducirErrorCliente(
  error: { code?: string },
  placa: string,
  nombre: string,
): Error {
  if (error.code === "23505") {
    return new Error(mensajeDuplicado(null, placa, nombre));
  }
  return error as unknown as Error;
}
