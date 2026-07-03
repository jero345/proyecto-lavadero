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
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Orden } from "@/types/database.types";

/**
 * Botón para eliminar una orden equivocada, con confirmación. Un empleado solo
 * puede borrar órdenes NO cobradas (el servidor lo reafirma en `eliminar_orden`).
 */
export function EliminarOrdenButton({
  orden,
  showLabel = false,
}: {
  orden: Orden;
  showLabel?: boolean;
}) {
  const { isStaff } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Un empleado no puede eliminar una orden ya cobrada (revertir caja es de admin).
  if (!isStaff && orden.metodo_pago != null) return null;

  const eliminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("eliminar_orden", { p_orden_id: orden.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Orden eliminada");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
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
          title="Eliminar orden"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {showLabel && "Eliminar"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar la orden {orden.placa || ""}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer.
            {orden.metodo_pago != null
              ? " Se eliminará la orden y su ingreso registrado en caja."
              : " Se eliminará la orden por completo."}
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
