import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Droplets,
  Flame,
  Home,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCOP, formatFecha } from "@/lib/format";
import { LABEL_METODO_PAGO, METODOS_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import type { GastoFijo, MetodoPago } from "@/types/database.types";

/** Categorías que ofrece la app. En la BD `categoria` es texto libre. */
const CATEGORIAS: { value: string; label: string; Icon: LucideIcon; color: string }[] = [
  { value: "arriendo", label: "Arriendo", Icon: Home, color: "bg-indigo-100 text-indigo-600" },
  { value: "agua", label: "Agua", Icon: Droplets, color: "bg-sky-100 text-sky-600" },
  { value: "luz", label: "Luz", Icon: Zap, color: "bg-amber-100 text-amber-600" },
  { value: "gas", label: "Gas", Icon: Flame, color: "bg-orange-100 text-orange-600" },
  { value: "internet", label: "Internet", Icon: Wifi, color: "bg-violet-100 text-violet-600" },
  { value: "telefono", label: "Teléfono", Icon: Phone, color: "bg-teal-100 text-teal-600" },
  { value: "otro", label: "Otro", Icon: Receipt, color: "bg-slate-100 text-slate-600" },
];

const OTRA = { value: "otro", label: "Otro", Icon: Receipt, color: "bg-slate-100 text-slate-600" };

function categoria(valor: string) {
  return CATEGORIAS.find((c) => c.value === valor) ?? { ...OTRA, label: valor };
}

/** Mes actual como "YYYY-MM" (hora local, no UTC). */
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Hoy como "YYYY-MM-DD" (hora local) para el <input type="date">. */
function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function Gastos() {
  const [mes, setMes] = useState(mesActual);
  const [editando, setEditando] = useState<GastoFijo | "nuevo" | null>(null);

  const { data: gastos = [], isLoading } = useQuery({
    queryKey: ["gastos"],
    queryFn: async (): Promise<GastoFijo[]> => {
      const { data, error } = await supabase
        .from("gastos_fijos")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  // Mes vacío = todos los meses.
  const filtrados = useMemo(
    () => (mes ? gastos.filter((g) => g.fecha.startsWith(mes)) : gastos),
    [gastos, mes],
  );

  const total = useMemo(
    () => filtrados.reduce((acc, g) => acc + Number(g.monto), 0),
    [filtrados],
  );

  // Un recuadro por categoría con gasto en el periodo, de mayor a menor.
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const g of filtrados) {
      mapa.set(g.categoria, (mapa.get(g.categoria) ?? 0) + Number(g.monto));
    }
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtrados]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Gastos fijos</h2>
          <p className="text-xs text-muted-foreground">
            Arriendo y pago de servicios. Cada pago decide si{" "}
            <strong>sale de la caja</strong> (egreso de la caja principal, entra
            al cierre del día) o si queda solo en este registro.
          </p>
        </div>
        <Button onClick={() => setEditando("nuevo")}>
          <Plus className="h-4 w-4" />
          Registrar pago
        </Button>
      </div>

      {/* Periodo + total */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="g-mes" className="text-xs text-muted-foreground">
            Mes
          </Label>
          <Input
            id="g-mes"
            type="month"
            className="w-44"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
          />
        </div>
        {mes && (
          <Button variant="ghost" onClick={() => setMes("")}>
            Ver todos los meses
          </Button>
        )}
        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">
            Total {mes ? "del mes" : "de todo el historial"}
          </p>
          <p className="text-2xl font-bold text-destructive">{formatCOP(total)}</p>
        </div>
      </div>

      {/* Desglose por categoría */}
      {porCategoria.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {porCategoria.map(([cat, monto]) => {
            const { label, Icon, color } = categoria(cat);
            return (
              <Card key={cat}>
                <CardContent className="flex items-center gap-3 p-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      color,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{label}</p>
                    <p className="font-bold">{formatCOP(monto)}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {gastos.length === 0
                ? "Aún no hay gastos registrados. Empieza con “Registrar pago”."
                : "No hay gastos en el mes seleccionado."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((g) => {
                    const { label, Icon, color } = categoria(g.categoria);
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatFecha(g.fecha)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <span
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-md",
                                color,
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            {label}
                          </span>
                        </TableCell>
                        <TableCell>{g.concepto || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            {g.metodo_pago ? LABEL_METODO_PAGO[g.metodo_pago] : "—"}
                            {/* Marca los que sí descontaron de la caja. */}
                            {g.caja_movimiento_id && (
                              <Badge
                                variant="outline"
                                className="border-rose-200 bg-rose-50 text-rose-700"
                              >
                                En caja
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium text-destructive">
                          -{formatCOP(g.monto)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Editar gasto"
                              onClick={() => setEditando(g)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <EliminarGastoButton gasto={g} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editando && (
        <GastoDialog
          key={editando === "nuevo" ? "nuevo" : editando.id}
          gasto={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

/** Alta y edición de un gasto fijo. */
function GastoDialog({
  gasto,
  onClose,
}: {
  gasto: GastoFijo | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [cat, setCat] = useState(gasto?.categoria ?? "arriendo");
  const [concepto, setConcepto] = useState(gasto?.concepto ?? "");
  const [monto, setMonto] = useState(gasto ? String(gasto.monto) : "");
  const [fecha, setFecha] = useState(gasto?.fecha ?? hoyISO());
  // "" = sin especificar (la columna admite null).
  const [metodo, setMetodo] = useState<MetodoPago | "">(gasto?.metodo_pago ?? "");
  // Un gasto sale de la caja cuando tiene su egreso atado. Los nuevos vienen
  // marcados: lo normal es que el arriendo y los servicios se paguen del local.
  const [afectaCaja, setAfectaCaja] = useState(
    gasto ? gasto.caja_movimiento_id != null : true,
  );

  const guardar = useMutation({
    mutationFn: async () => {
      const valor = Number(monto);
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Monto inválido");
      if (!fecha) throw new Error("La fecha es obligatoria");
      if (afectaCaja && metodo === "") {
        throw new Error("Elige el método de pago para descontarlo de la caja");
      }

      // El servidor crea, actualiza o borra el egreso de caja según corresponda.
      const { error } = await supabase.rpc("guardar_gasto_fijo", {
        p_id: gasto?.id ?? null,
        p_categoria: cat,
        p_concepto: concepto.trim() || null,
        p_monto: valor,
        p_fecha: fecha,
        p_metodo_pago: metodo === "" ? null : metodo,
        p_afecta_caja: afectaCaja,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(gasto ? "Gasto actualizado" : "Gasto registrado", {
        description: afectaCaja ? "Descontado de la caja principal" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["gastos"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo guardar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{gasto ? "Editar gasto" : "Registrar pago"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Categoría</Label>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="g-concepto">Concepto (opcional)</Label>
            <Input
              id="g-concepto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: local principal · factura de julio"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="g-monto">Monto</Label>
              <Input
                id="g-monto"
                type="number"
                min={0}
                placeholder="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-fecha">Fecha del pago</Label>
              <Input
                id="g-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Método de pago{afectaCaja ? "" : " (opcional)"}</Label>
            <Select
              value={metodo === "" ? "ninguno" : metodo}
              onValueChange={(v) => setMetodo(v === "ninguno" ? "" : (v as MetodoPago))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguno">Sin especificar</SelectItem>
                {METODOS_PAGO.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Con esto marcado, el pago sale de la caja principal como egreso y
              entra en el cierre del día (control del arriendo y los servicios). */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={afectaCaja}
              onChange={(e) => setAfectaCaja(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium">Descontar de la caja</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {afectaCaja
                  ? "Se registra un egreso en la caja principal con la fecha del pago; cuenta en el cierre de ese día."
                  : "Queda solo en este registro de gastos (por ejemplo, si se paga desde el banco)."}
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EliminarGastoButton({ gasto }: { gasto: GastoFijo }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const eliminar = useMutation({
    mutationFn: async () => {
      // El servidor borra también su egreso de caja (si no está cerrado).
      const { error } = await supabase.rpc("eliminar_gasto_fijo", { p_id: gasto.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto eliminado");
      queryClient.invalidateQueries({ queryKey: ["gastos"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          title="Eliminar gasto"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Eliminar el gasto de {categoria(gasto.categoria).label}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {formatCOP(gasto.monto)} del {formatFecha(gasto.fecha)}. Esta acción no se
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
