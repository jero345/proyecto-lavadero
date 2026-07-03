import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCOP } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { METODOS_PAGO } from "@/lib/dominio";
import type { MetodoPago, Orden } from "@/types/database.types";

/**
 * Diálogo para cobrar una orden pendiente (registra el pago + ingreso a caja
 * vía la RPC cobrar_orden). Compartido por Dashboard y Órdenes.
 */
export function CobrarOrdenDialog({
  orden,
  onClose,
}: {
  orden: Orden;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [metodo, setMetodo] = useState<MetodoPago | "">("");

  const cobrar = useMutation({
    mutationFn: async () => {
      if (!metodo) throw new Error("Selecciona el método de pago");
      const { error } = await supabase.rpc("cobrar_orden", {
        p_orden_id: orden.id,
        p_metodo_pago: metodo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Orden cobrada", {
        description: `Total ${formatCOP(orden.total)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo cobrar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cobrar orden {orden.placa || ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md bg-muted p-3">
            <span className="text-sm text-muted-foreground">Total a cobrar</span>
            <span className="text-xl font-bold">{formatCOP(orden.total)}</span>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Método de pago</label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona método" />
              </SelectTrigger>
              <SelectContent>
                {METODOS_PAGO.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => cobrar.mutate()} disabled={cobrar.isPending}>
            {cobrar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
