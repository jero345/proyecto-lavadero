import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Cliente, Empleado, Orden, Servicio } from "@/types/database.types";

/** Orden + nombre del empleado asignado (todos sus ítems comparten empleado). */
export type OrdenConEmpleado = Orden & { empleado_nombre: string | null };

/** Extrae el nombre del empleado de los ítems embebidos y lo aplana en la orden. */
export function aplanarEmpleado(o: Record<string, unknown>): OrdenConEmpleado {
  const { orden_items, ...orden } = o as Orden & {
    orden_items?: { empleado?: { nombre?: string | null } | null }[];
  };
  const nombre = orden_items?.[0]?.empleado?.nombre ?? null;
  return { ...(orden as Orden), empleado_nombre: nombre };
}
/** Select de órdenes con el empleado asignado embebido (vía orden_items). */
export const SELECT_ORDEN_CON_EMPLEADO = "*, orden_items(empleado:empleados(nombre))";

/** Empleados (roster) activos para asignar en órdenes/nómina. */
export function useEmpleados() {
  return useQuery({
    queryKey: ["empleados"],
    queryFn: async (): Promise<Empleado[]> => {
      const { data, error } = await supabase
        .from("empleados")
        .select("*")
        .eq("activo", true)
        .order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

/** Catálogo de servicios activos. */
export function useServicios(soloActivos = true) {
  return useQuery({
    queryKey: ["servicios", soloActivos],
    queryFn: async (): Promise<Servicio[]> => {
      let q = supabase.from("servicios").select("*").order("precio");
      if (soloActivos) q = q.eq("activo", true);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

/** Lista de clientes. */
export function useClientes() {
  return useQuery({
    queryKey: ["clientes"],
    queryFn: async (): Promise<Cliente[]> => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

/** Todas las órdenes (para la sección Órdenes). RLS filtra según el rol. */
export function useOrdenes() {
  return useQuery({
    queryKey: ["ordenes", "todas"],
    queryFn: async (): Promise<OrdenConEmpleado[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select(SELECT_ORDEN_CON_EMPLEADO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(aplanarEmpleado);
    },
  });
}

/**
 * Órdenes pendientes de cobro (metodo_pago null), en cualquier estado.
 * Base de los "recordatorios de sin cobrar".
 */
export function useOrdenesSinCobrar() {
  return useQuery({
    queryKey: ["ordenes", "sin-cobrar"],
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .is("metodo_pago", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
