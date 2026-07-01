import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Clock, DollarSign, ArrowRight, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { formatCOP, formatFechaHora } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { imprimirReciboOrden } from "@/lib/recibo";
import { CLASE_ESTADO, LABEL_ESTADO, METODOS_PAGO } from "@/lib/dominio";
import { useRealtimeOrdenes } from "@/hooks/useRealtimeOrdenes";
import type { EstadoOrden, MetodoPago, Orden } from "@/types/database.types";

const SIGUIENTE_ESTADO: Record<EstadoOrden, EstadoOrden | null> = {
  en_proceso: "completado",
  completado: "entregado",
  entregado: null,
};

function inicioDeHoyISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  useRealtimeOrdenes();
  const [cobrarDe, setCobrarDe] = useState<Orden | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<string | null>(null);

  // Imprime el recibo: trae los ítems (servicio + empleado) y lanza la impresión.
  async function imprimirRecibo(orden: Orden) {
    setImprimiendoId(orden.id);
    try {
      const { data, error } = await supabase
        .from("orden_items")
        .select("precio, servicios(nombre), empleados(nombre)")
        .eq("orden_id", orden.id)
        .returns<
          {
            precio: number;
            servicios: { nombre: string } | null;
            empleados: { nombre: string } | null;
          }[]
        >();
      if (error) throw error;

      const items = (data ?? []).map((r) => ({
        nombre: r.servicios?.nombre ?? "Servicio",
        precio: Number(r.precio),
      }));
      const atendio = data?.find((r) => r.empleados?.nombre)?.empleados?.nombre ?? null;

      imprimirReciboOrden({ orden, items, atendio });
    } catch (e) {
      toast.error("No se pudo generar el recibo", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setImprimiendoId(null);
    }
  }

  // Órdenes activas (no entregadas) — "vehículos en proceso".
  const { data: activas = [], isLoading: cargandoActivas } = useQuery({
    queryKey: ["dashboard", "activas"],
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .neq("estado", "entregado")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Órdenes de hoy (para KPIs).
  const { data: hoy = [] } = useQuery({
    queryKey: ["dashboard", "hoy"],
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .gte("created_at", inicioDeHoyISO());
      if (error) throw error;
      return data;
    },
  });

  // Órdenes ya entregadas pero sin cobrar (se salieron del flujo "en proceso").
  // Solo es relevante para staff (cobrar toca caja).
  const { data: sinCobrar = [] } = useQuery({
    queryKey: ["dashboard", "sin-cobrar"],
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .eq("estado", "entregado")
        .is("metodo_pago", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Ingresos reales en caja hoy = solo órdenes ya cobradas (con método de pago).
  // Las agendadas (pendientes de cobro) no cuentan hasta que se cobren.
  const ingresosHoy = useMemo(
    () =>
      hoy
        .filter((o) => o.metodo_pago != null)
        .reduce((acc, o) => acc + Number(o.total), 0),
    [hoy],
  );

  const avanzarEstado = useMutation({
    mutationFn: async ({ id }: { id: string; estado: EstadoOrden }) => {
      // La función del servidor calcula el siguiente estado y solo toca esa columna.
      const { error } = await supabase.rpc("avanzar_estado_orden", { p_orden_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          titulo="Vehículos en proceso"
          valor={activas.length.toString()}
          icon={<Car className="h-5 w-5" />}
          color="bg-blue-100 text-blue-600"
        />
        <KpiCard
          titulo="Órdenes de hoy"
          valor={hoy.length.toString()}
          icon={<Clock className="h-5 w-5" />}
          color="bg-violet-100 text-violet-600"
        />
        <KpiCard
          titulo="Ingresos de hoy"
          valor={formatCOP(ingresosHoy)}
          icon={<DollarSign className="h-5 w-5" />}
          color="bg-emerald-100 text-emerald-600"
        />
      </div>

      {/* Vehículos en proceso (realtime) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vehículos en proceso</CardTitle>
          <Badge variant="secondary" className="gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            En vivo
          </Badge>
        </CardHeader>
        <CardContent>
          {cargandoActivas ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : activas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay vehículos en proceso.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {activas.map((o) => (
                <div key={o.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-lg font-bold tracking-wide">
                        {o.placa || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFechaHora(o.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={CLASE_ESTADO[o.estado]} variant="outline">
                        {LABEL_ESTADO[o.estado]}
                      </Badge>
                      {o.metodo_pago == null ? (
                        <Badge
                          variant="outline"
                          className="border-rose-200 bg-rose-50 text-rose-700"
                        >
                          Sin cobrar
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-50 text-green-700"
                        >
                          Pagado
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{formatCOP(o.total)}</span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={imprimiendoId === o.id}
                        title="Imprimir recibo"
                        onClick={() => void imprimirRecibo(o)}
                      >
                        {imprimiendoId === o.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                        Recibo
                      </Button>
                      {o.metodo_pago == null && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCobrarDe(o)}
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          Cobrar
                        </Button>
                      )}
                      {SIGUIENTE_ESTADO[o.estado] && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={avanzarEstado.isPending || o.metodo_pago == null}
                          title={
                            o.metodo_pago == null
                              ? "Cobra la orden antes de completarla"
                              : undefined
                          }
                          onClick={() =>
                            avanzarEstado.mutate({ id: o.id, estado: o.estado })
                          }
                        >
                          {avanzarEstado.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              {LABEL_ESTADO[SIGUIENTE_ESTADO[o.estado]!]}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {sinCobrar.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entregadas sin cobrar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sinCobrar.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50/60 p-3"
                >
                  <div>
                    <p className="font-bold tracking-wide">{o.placa || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFechaHora(o.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{formatCOP(o.total)}</span>
                    <Button size="sm" variant="secondary" onClick={() => setCobrarDe(o)}>
                      <DollarSign className="h-3.5 w-3.5" />
                      Cobrar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {cobrarDe && (
        <CobrarOrdenDialog
          key={cobrarDe.id}
          orden={cobrarDe}
          onClose={() => setCobrarDe(null)}
        />
      )}
    </div>
  );
}

function CobrarOrdenDialog({
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

function KpiCard({
  titulo,
  valor,
  icon,
  color = "bg-primary/10 text-primary",
}: {
  titulo: string;
  valor: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-2xl font-bold">{valor}</p>
        </div>
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${color}`}
        >
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}
