// Puente entre la orden (en la base) y el recibo imprimible: trae los ítems
// (servicio + empleado que atendió) y lanza la impresión.

import { supabase } from "./supabase";
import { imprimirReciboOrden } from "./recibo";
import type { Orden } from "@/types/database.types";

/** Carga los ítems de la orden e imprime su recibo. Lanza si falla la carga. */
export async function imprimirReciboDeOrden(orden: Orden) {
  const { data, error } = await supabase
    .from("orden_items")
    .select("precio, servicios(nombre), empleados(nombre)")
    .eq("orden_id", orden.id)
    .returns<
      {
        precio: number;
        servicios: { nombre: string } | null;
        empleados: { nombre: string } | null;
      }[]
    >();
  if (error) throw error;

  const items = (data ?? []).map((r) => ({
    nombre: r.servicios?.nombre ?? "Servicio",
    precio: Number(r.precio),
  }));
  const atendio = data?.find((r) => r.empleados?.nombre)?.empleados?.nombre ?? null;

  imprimirReciboOrden({ orden, items, atendio });
}
