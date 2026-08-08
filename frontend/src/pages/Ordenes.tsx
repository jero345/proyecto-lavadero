import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CobrarOrdenDialog } from "@/components/CobrarOrdenDialog";
import { EliminarOrdenButton } from "@/components/EliminarOrdenButton";
import { formatCOP, formatFecha, formatFechaHora } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { imprimirReciboDeOrden } from "@/lib/recibo-orden";
import { CLASE_ESTADO, LABEL_ESTADO, LABEL_METODO_PAGO } from "@/lib/dominio";
import { useAuth } from "@/hooks/useAuth";
import { useOrdenes } from "@/hooks/queries";
import { useRealtimeOrdenes } from "@/hooks/useRealtimeOrdenes";
import type { EstadoOrden, Orden } from "@/types/database.types";

const SIGUIENTE_ESTADO: Record<EstadoOrden, EstadoOrden | null> = {
  en_proceso: "completado",
  completado: "entregado",
  entregado: null,
};

type FiltroEstado = EstadoOrden | "todos";
type FiltroCobro = "todos" | "sin_cobrar" | "pagado";
/** Empleado A–Z (agrupa el trabajo de cada uno) o las más recientes primero. */
type Orden_ = "empleado" | "fecha";

/** Día local (YYYY-MM-DD) de una fecha ISO. No usar toISOString(): da UTC. */
function diaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "Hoy", "Ayer" o la fecha con el día de la semana. */
function etiquetaDia(dia: string): string {
  const hoy = diaLocal(new Date().toISOString());
  if (dia === hoy) return "Hoy";
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (dia === diaLocal(ayer.toISOString())) return "Ayer";
  const texto = formatFecha(dia, {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export default function Ordenes() {
  const { isStaff } = useAuth();
  const queryClient = useQueryClient();
  useRealtimeOrdenes();
  const { data: ordenes = [], isLoading } = useOrdenes();

  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>("todos");
  const [cobro, setCobro] = useState<FiltroCobro>("todos");
  const [orden, setOrden] = useState<Orden_>("empleado");
  const [cobrarDe, setCobrarDe] = useState<Orden | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<string | null>(null);

  const avanzarEstado = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("avanzar_estado_orden", { p_orden_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  async function imprimir(orden: Orden) {
    setImprimiendoId(orden.id);
    try {
      await imprimirReciboDeOrden(orden);
    } catch (e) {
      toast.error("No se pudo generar el recibo", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setImprimiendoId(null);
    }
  }

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = ordenes.filter((o) => {
      if (estado !== "todos" && o.estado !== estado) return false;
      if (cobro === "sin_cobrar" && o.metodo_pago != null) return false;
      if (cobro === "pagado" && o.metodo_pago == null) return false;
      if (q && !(o.placa ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    // Por empleado: A–Z y, dentro de cada uno, lo más reciente primero. Las
    // órdenes sin asignar quedan al final.
    if (orden === "empleado") {
      return [...lista].sort((a, b) => {
        const na = a.empleado_nombre ?? "";
        const nb = b.empleado_nombre ?? "";
        if (na !== nb) {
          if (!na) return 1;
          if (!nb) return -1;
          return na.localeCompare(nb, "es");
        }
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return lista;
  }, [ordenes, busqueda, estado, cobro, orden]);

  const totalMostrado = useMemo(
    () => filtradas.reduce((acc, o) => acc + Number(o.total), 0),
    [filtradas],
  );

  // Una carpeta por día (la más reciente arriba): las de días pasados quedan
  // recogidas y no se mezclan con las de hoy.
  const porDia = useMemo(() => {
    const m = new Map<string, typeof filtradas>();
    for (const o of filtradas) {
      const dia = diaLocal(o.created_at);
      const lista = m.get(dia);
      if (lista) lista.push(o);
      else m.set(dia, [o]);
    }
    return [...m.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dia, ordenes]) => ({
        dia,
        ordenes,
        total: ordenes.reduce((acc, o) => acc + Number(o.total), 0),
      }));
  }, [filtradas]);

  // null = comportamiento por defecto: solo el día más reciente abierto.
  const [diasAbiertos, setDiasAbiertos] = useState<Set<string> | null>(null);
  const diaReciente = porDia[0]?.dia;
  const estaAbierto = (dia: string) =>
    diasAbiertos ? diasAbiertos.has(dia) : dia === diaReciente;

  function alternarDia(dia: string) {
    setDiasAbiertos((prev) => {
      const next = new Set(prev ?? (diaReciente ? [diaReciente] : []));
      if (!next.delete(dia)) next.add(dia);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Órdenes</h2>
        <span className="text-sm text-muted-foreground">
          {filtradas.length} orden{filtradas.length === 1 ? "" : "es"}
          {isStaff && ` · ${formatCOP(totalMostrado)}`}
        </span>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por placa…"
            className="pl-8"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={estado} onValueChange={(v) => setEstado(v as FiltroEstado)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="en_proceso">En proceso</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="entregado">Entregado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cobro} onValueChange={(v) => setCobro(v as FiltroCobro)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Cobro: todos</SelectItem>
            <SelectItem value="sin_cobrar">Sin cobrar</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={orden} onValueChange={(v) => setOrden(v as Orden_)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="empleado">Empleado (A–Z)</SelectItem>
            <SelectItem value="fecha">Más recientes primero</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay órdenes que coincidan.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Placa</TableHead>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Servicios</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Pago</TableHead>
                    {isStaff && <TableHead className="text-right">Total</TableHead>}
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porDia.map(({ dia, ordenes, total }) => [
                    /* Cabecera de la carpeta del día */
                    <TableRow
                      key={`dia-${dia}`}
                      className="cursor-pointer bg-muted/40 hover:bg-muted/60"
                      onClick={() => alternarDia(dia)}
                    >
                      <TableCell colSpan={isStaff ? 8 : 7} className="py-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {estaAbierto(dia) ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          {etiquetaDia(dia)}
                          <span className="font-normal text-muted-foreground">
                            · {ordenes.length} orden{ordenes.length === 1 ? "" : "es"}
                            {isStaff && ` · ${formatCOP(total)}`}
                          </span>
                        </span>
                      </TableCell>
                    </TableRow>,
                    ...(estaAbierto(dia) ? ordenes : []).map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatFechaHora(o.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {o.placa || "—"}
                        {/* La nota que escribió quien recibió el vehículo. */}
                        {o.observaciones && (
                          <span
                            className="mt-0.5 block max-w-[220px] truncate text-xs font-normal text-amber-700"
                            title={o.observaciones}
                          >
                            {o.observaciones}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {o.empleado_nombre || "—"}
                      </TableCell>
                      {/* Qué se le hizo al vehículo en esta orden. */}
                      <TableCell className="max-w-[280px] text-sm">
                        {o.servicios.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className="line-clamp-2"
                            title={o.servicios.join(" · ")}
                          >
                            {o.servicios.join(" · ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={CLASE_ESTADO[o.estado]}>
                          {LABEL_ESTADO[o.estado]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {o.metodo_pago == null ? (
                          <Badge
                            variant="outline"
                            className="border-rose-200 bg-rose-50 text-rose-700"
                          >
                            Sin cobrar
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {LABEL_METODO_PAGO[o.metodo_pago]}
                          </span>
                        )}
                      </TableCell>
                      {isStaff && (
                        <TableCell className="text-right font-medium">
                          {formatCOP(o.total)}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {isStaff && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={imprimiendoId === o.id}
                              title="Imprimir recibo"
                              onClick={() => void imprimir(o)}
                            >
                              {imprimiendoId === o.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Printer className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                          {o.metodo_pago == null && (
                            <Button size="sm" variant="secondary" onClick={() => setCobrarDe(o)}>
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
                              onClick={() => avanzarEstado.mutate(o.id)}
                            >
                              {LABEL_ESTADO[SIGUIENTE_ESTADO[o.estado]!]}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <EliminarOrdenButton orden={o} />
                        </div>
                      </TableCell>
                    </TableRow>
                    )),
                  ])}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
