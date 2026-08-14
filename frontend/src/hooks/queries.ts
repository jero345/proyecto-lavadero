import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type {
  Cliente,
  Empleado,
  Orden,
  Servicio,
  TipoVehiculoRow,
} from "@/types/database.types";

/** Catálogo de tipos de vehículo. soloActivos=true para el POS/servicios. */
export function useTiposVehiculo(soloActivos = true) {
  return useQuery({
    queryKey: ["tipos_vehiculo", soloActivos],
    queryFn: async (): Promise<TipoVehiculoRow[]> => {
      let q = supabase.from("tipos_vehiculo").select("*").order("orden").order("nombre");
      if (soloActivos) q = q.eq("activo", true);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Orden + nombre del empleado asignado (todos sus ítems comparten empleado) y
 * datos de contacto del cliente (para llamarlo o escribirle por WhatsApp).
 */
export type OrdenConEmpleado = Orden & {
  empleado_nombre: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  /** Servicios de la orden, alfabéticos (qué se le hizo al vehículo). */
  servicios: string[];
};

/** Aplana el empleado y los servicios (vía ítems) y el cliente de la orden. */
export function aplanarEmpleado(o: Record<string, unknown>): OrdenConEmpleado {
  const { orden_items, cliente, ...orden } = o as Orden & {
    orden_items?: {
      empleado?: { nombre?: string | null } | null;
      servicio?: { nombre?: string | null } | null;
    }[];
    cliente?: { nombre?: string | null; telefono?: string | null } | null;
  };
  const servicios = (orden_items ?? [])
    .map((i) => i.servicio?.nombre)
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    ...(orden as Orden),
    empleado_nombre: orden_items?.[0]?.empleado?.nombre ?? null,
    cliente_nombre: cliente?.nombre ?? null,
    cliente_telefono: cliente?.telefono ?? null,
    servicios,
  };
}
/** Select de órdenes con empleado y servicios (vía orden_items) y el cliente. */
// Debe ser un literal de una sola pieza: supabase-js infiere los tipos del
// texto del select, y una concatenación lo convierte en `string` y rompe todo.
// prettier-ignore
export const SELECT_ORDEN_CON_EMPLEADO = "*, orden_items(empleado:empleados(nombre), servicio:servicios(nombre)), cliente:clientes(nombre,telefono)";

/**
 * Empleados (roster). Por defecto solo los activos, que son los que se pueden
 * asignar a una orden; con `soloActivos=false` trae también los inactivos, para
 * poder mostrar el nombre de quien ya no trabaja pero tiene historial.
 */
export function useEmpleados(soloActivos = true) {
  return useQuery({
    queryKey: ["empleados", soloActivos],
    queryFn: async (): Promise<Empleado[]> => {
      let q = supabase.from("empleados").select("*").order("nombre");
      if (soloActivos) q = q.eq("activo", true);
      const { data, error } = await q;
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
 * Trabajadores con órdenes de hoy a los que todavía no se les liquidó la nómina
 * del día. Base del aviso "falta liquidar" (Dashboard y Nómina).
 */
export function useNominaPendiente() {
  return useQuery({
    queryKey: ["nomina", "pendientes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("empleados_pendientes_liquidar");
      if (error) throw error;
      return data ?? [];
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
