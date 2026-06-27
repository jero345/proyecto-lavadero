import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/**
 * Se suscribe a los cambios de la tabla `ordenes` vía Supabase Realtime e
 * invalida las queries del dashboard para refrescar "vehículos en proceso".
 */
export function useRealtimeOrdenes() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const canal = supabase
      .channel("ordenes-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ordenes" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["ordenes"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [queryClient]);
}
