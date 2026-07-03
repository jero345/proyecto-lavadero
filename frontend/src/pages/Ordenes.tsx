import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, DollarSign, Loader2, Printer, Search } from "lucide-react";
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
import { formatCOP, formatFechaHora } from "@/lib/format";
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

export default function Ordenes() {
  const { isStaff } = useAuth();
  const queryClient = useQueryClient();
  useRealtimeOrdenes();
  const { data: ordenes = [], isLoading } = useOrdenes();

  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>("todos");
  const [cobro, setCobro] = useState<FiltroCobro>("todos");
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
    return ordenes.filter((o) => {
      if (estado !== "todos" && o.estado !== estado) return false;
      if (cobro === "sin_cobrar" && o.metodo_pago != null) return false;
      if (cobro === "pagado" && o.metodo_pago == null) return false;
      if (q && !(o.placa ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ordenes, busqueda, estado, cobro]);

  const totalMostrado = useMemo(
    () => filtradas.reduce((acc, o) => acc + Number(o.total), 0),
    [filtradas],
  );

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
                    <TableHead>Estado</TableHead>
                    <TableHead>Pago</TableHead>
                    {isStaff && <TableHead className="text-right">Total</TableHead>}
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatFechaHora(o.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">{o.placa || "—"}</TableCell>
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
                  ))}
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
