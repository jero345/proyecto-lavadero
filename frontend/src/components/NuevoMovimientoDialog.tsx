import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aInputFechaHora, desdeInputFechaHora, esHoy } from "@/lib/format";
import { METODOS_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import type { CajaTipo, MetodoPago, TipoMovCaja } from "@/types/database.types";

/**
 * Alta manual de un ingreso o egreso de caja. Permite poner una fecha distinta
 * a la de hoy: en ese caso el movimiento queda solo en el historial y NO afecta
 * la caja abierta ni el próximo cierre (lo decide el servidor, en
 * crear_movimiento).
 */
export function NuevoMovimientoDialog({
  caja,
  triggerLabel = "Movimiento",
  triggerVariant = "outline",
}: {
  /** Si se pasa, la caja queda fija; si no, el usuario la elige. */
  caja?: CajaTipo;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const [tipo, setTipo] = useState<TipoMovCaja>("egreso");
  const [concepto, setConcepto] = useState("");
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  const [monto, setMonto] = useState("");
  const [cajaSel, setCajaSel] = useState<CajaTipo>(caja ?? "principal");
  const [fecha, setFecha] = useState(() => aInputFechaHora());

  // Al abrir, la fecha vuelve a "ahora" (si no, queda congelada de la vez pasada).
  useEffect(() => {
    if (open) setFecha(aInputFechaHora());
  }, [open]);

  const fechaPasada = fecha !== "" && !esHoy(fecha);

  const crear = useMutation({
    mutationFn: async () => {
      const valor = Number(monto);
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Monto inválido");
      const { error } = await supabase.rpc("crear_movimiento", {
        p_tipo: tipo,
        p_concepto: concepto.trim() || null,
        p_metodo_pago: metodo,
        p_monto: valor,
        p_caja: caja ?? cajaSel,
        p_fecha: desdeInputFechaHora(fecha),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimiento registrado", {
        description: fechaPasada
          ? "Con fecha de otro día: queda en el historial, no afecta la caja abierta."
          : undefined,
      });
      setConcepto("");
      setMonto("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo registrar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className={caja ? "space-y-2" : "grid grid-cols-2 gap-3"}>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMovCaja)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingreso">Ingreso</SelectItem>
                  <SelectItem value="egreso">Egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!caja && (
              <div className="space-y-2">
                <Label>Caja</Label>
                <Select value={cajaSel} onValueChange={(v) => setCajaSel(v as CajaTipo)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="principal">Principal</SelectItem>
                    <SelectItem value="inventario">Inventario</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="nm-concepto">Concepto</Label>
            <Input
              id="nm-concepto"
              placeholder="Ej: compra de insumos"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Método</Label>
              <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="space-y-2">
              <Label htmlFor="nm-monto">Monto</Label>
              <Input
                id="nm-monto"
                type="number"
                min={0}
                placeholder="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nm-fecha">Fecha y hora</Label>
            <Input
              id="nm-fecha"
              type="datetime-local"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            {fechaPasada && (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No es de hoy: quedará registrado en el historial, pero no suma ni
                resta en la caja abierta ni entra al próximo cierre.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => crear.mutate()} disabled={crear.isPending}>
            {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
