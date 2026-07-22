import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatCOP, formatFecha } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { NominaLiquidacion } from "@/types/database.types";

/**
 * Botón para que el STAFF (admin/super_admin) elimine una liquidación mal hecha.
 * El servidor también borra el egreso de nómina asociado si sigue abierto en la
 * caja; si ya estaba en un cierre, ese movimiento se conserva.
 */
export function EliminarLiquidacionButton({
  liquidacion,
  nombreEmpleado,
}: {
  liquidacion: NominaLiquidacion;
  nombreEmpleado: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const eliminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("eliminar_liquidacion", {
        p_id: liquidacion.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Liquidación eliminada");
      queryClient.invalidateQueries({ queryKey: ["nomina"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error("No se pudo eliminar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          title="Eliminar liquidación"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta liquidación?</AlertDialogTitle>
          <AlertDialogDescription>
            {nombreEmpleado} · {formatFecha(liquidacion.fecha_inicio)} –{" "}
            {formatFecha(liquidacion.fecha_fin)} · {formatCOP(liquidacion.total_pagar)}.
            Si el pago sigue abierto en la caja, también se eliminará. Esta acción no se
            puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={eliminar.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={eliminar.isPending}
            onClick={(e) => {
              e.preventDefault();
              eliminar.mutate();
            }}
          >
            {eliminar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
