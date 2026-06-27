import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { Cliente, Empleado, Servicio } from "@/types/database.types";

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
