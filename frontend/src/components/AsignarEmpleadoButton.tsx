import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
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
import { supabase } from "@/lib/supabase";
import { useEmpleados } from "@/hooks/queries";
import type { Orden } from "@/types/database.types";

/**
 * Botón + diálogo para asignar (o cambiar) el empleado de una orden. Usa la RPC
 * asignar_empleado_orden, que actualiza todos los ítems de la orden. Sirve para
 * las órdenes creadas sin empleado desde el POS.
 */
export function AsignarEmpleadoButton({
  orden,
  empleadoNombre,
}: {
  orden: Orden;
  empleadoNombre?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: empleados = [] } = useEmpleados();
  const [open, setOpen] = useState(false);
  const [empleadoId, setEmpleadoId] = useState("");

  const asignar = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error("Selecciona un empleado");
      const { error } = await supabase.rpc("asignar_empleado_orden", {
        p_orden_id: orden.id,
        p_empleado_id: empleadoId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empleado asignado");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error("No se pudo asignar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        title={empleadoNombre ? "Cambiar empleado" : "Asignar empleado"}
        onClick={() => {
          // Precarga el empleado actual (si lo tiene) para "cambiar".
          setEmpleadoId(empleados.find((e) => e.nombre === empleadoNombre)?.id ?? "");
          setOpen(true);
        }}
      >
        <UserPlus className="h-3.5 w-3.5" />
        {empleadoNombre ? "Cambiar" : "Asignar"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {empleadoNombre ? "Cambiar empleado" : "Asignar empleado"}
              {orden.placa ? ` · ${orden.placa}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Empleado</label>
            <Select value={empleadoId} onValueChange={setEmpleadoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona empleado" />
              </SelectTrigger>
              <SelectContent>
                {empleados.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={() => asignar.mutate()} disabled={asignar.isPending}>
              {asignar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
