import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCOP, formatFecha, formatFechaHora } from "@/lib/format";
import { METODOS_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useEmpleados } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { EliminarLiquidacionButton } from "@/components/EliminarLiquidacionButton";
import { AvisoNominaPendiente } from "@/components/AvisoNominaPendiente";
import type { MetodoPago, NominaLiquidacion } from "@/types/database.types";

/**
 * Fecha local en formato YYYY-MM-DD. NO usar toISOString(): convierte a UTC y en
 * Colombia (UTC-5) devuelve el día siguiente en la tarde/noche.
 */
function fechaLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function primerDiaDelMes() {
  const d = new Date();
  return fechaLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function hoyISO() {
  return fechaLocalISO(new Date());
}

export default function Nomina() {
  const queryClient = useQueryClient();
  const { isStaff } = useAuth();
  const { data: empleados = [] } = useEmpleados();
  // Incluye inactivos: sus liquidaciones viejas tienen que seguir con nombre.
  const { data: todosLosEmpleados = [] } = useEmpleados(false);

  const [empleadoId, setEmpleadoId] = useState("");
  const [inicio, setInicio] = useState(primerDiaDelMes());
  const [fin, setFin] = useState(hoyISO());
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  // Liquidación abierta: muestra qué servicios hizo el empleado en ese periodo.
  const [abierta, setAbierta] = useState<string | null>(null);
  // Carpetas de empleado abiertas (cada trabajador lleva sus liquidaciones).
  const [carpetas, setCarpetas] = useState<Set<string>>(new Set());

  const alternarCarpeta = (id: string) =>
    setCarpetas((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of todosLosEmpleados) m.set(e.id, e.nombre);
    return m;
  }, [todosLosEmpleados]);

  const { data: liquidaciones = [] } = useQuery({
    queryKey: ["nomina", "liquidaciones"],
    queryFn: async (): Promise<NominaLiquidacion[]> => {
      const { data, error } = await supabase
        .from("nomina_liquidaciones")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Una "carpeta" por trabajador, alfabética, con sus liquidaciones adentro.
  const porEmpleado = useMemo(() => {
    const m = new Map<string, NominaLiquidacion[]>();
    for (const l of liquidaciones) {
      const lista = m.get(l.empleado_id);
      if (lista) lista.push(l);
      else m.set(l.empleado_id, [l]);
    }
    return [...m.entries()]
      .map(([id, ls]) => ({
        id,
        nombre: nombrePorId.get(id) ?? "Empleado eliminado",
        liquidaciones: ls,
        totalPagado: ls.reduce((acc, l) => acc + Number(l.total_pagar), 0),
        servicios: ls.reduce((acc, l) => acc + Number(l.total_servicios), 0),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [liquidaciones, nombrePorId]);

  // A cada trabajador se le liquida una sola vez al día (lo impone el servidor,
  // migración 0032). Acá se refleja en la pantalla para no dejar intentarlo.
  const liquidadosHoy = useMemo(() => {
    const hoy = hoyISO();
    const s = new Set<string>();
    for (const l of liquidaciones) {
      if (fechaLocalISO(new Date(l.created_at)) === hoy) s.add(l.empleado_id);
    }
    return s;
  }, [liquidaciones]);
  const yaLiquidadoHoy = empleadoId !== "" && liquidadosHoy.has(empleadoId);

  const liquidar = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error("Selecciona un empleado");
      const { data, error } = await supabase.rpc("liquidar_nomina", {
        p_empleado_id: empleadoId,
        p_fecha_inicio: inicio,
        p_fecha_fin: fin,
        p_metodo_pago: metodo,
      });
      if (error) throw error;
      return data as NominaLiquidacion;
    },
    onSuccess: (l) => {
      toast.success("Liquidación generada", {
        description:
          l.total_pagar > 0
            ? `A pagar ${formatCOP(l.total_pagar)} · egreso registrado en caja`
            : `${l.total_servicios} servicios · sin monto a pagar`,
      });
      // La liquidación mete un egreso en la caja principal.
      queryClient.invalidateQueries({ queryKey: ["nomina"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      // El tablero de la dashboard se limpia con el nuevo cierre de nómina.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo liquidar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      {/* Quiénes trabajaron hoy y todavía no tienen su liquidación del día. */}
      <AvisoNominaPendiente enlazar={false} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liquidar nómina</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-2">
              <Label>Empleado</Label>
              <Select value={empleadoId} onValueChange={setEmpleadoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {empleados.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre} · {e.porcentaje_comision}%
                      {liquidadosHoy.has(e.id) && " · ya liquidado hoy"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inicio">Desde</Label>
              <Input
                id="inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fin">Hasta</Label>
              <Input
                id="fin"
                type="date"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pago con</Label>
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
            <Button
              onClick={() => liquidar.mutate()}
              disabled={liquidar.isPending || yaLiquidadoHoy}
              title={
                yaLiquidadoHoy
                  ? "A este trabajador ya se le liquidó hoy"
                  : undefined
              }
            >
              {liquidar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              Liquidar
            </Button>
          </div>
          {yaLiquidadoHoy ? (
            <p className="mt-3 text-xs font-medium text-amber-700">
              A este trabajador ya se le liquidó hoy. Solo se puede liquidar una vez
              al día.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Al liquidar, el monto a pagar se registra como <strong>egreso</strong> en
              la caja principal con el método elegido. Cada trabajador se liquida una
              sola vez al día.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Liquidaciones: una carpeta por trabajador, para no mezclarlos. */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Liquidaciones por trabajador</h2>

        {liquidaciones.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Aún no hay liquidaciones.
            </CardContent>
          </Card>
        ) : (
          porEmpleado.map((emp) => {
            const abiertaCarpeta = carpetas.has(emp.id);
            return (
              <Card key={emp.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => alternarCarpeta(emp.id)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                    {abiertaCarpeta ? (
                      <FolderOpen className="h-4 w-4" />
                    ) : (
                      <Folder className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{emp.nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      {emp.liquidaciones.length} liquidación
                      {emp.liquidaciones.length === 1 ? "" : "es"} · {emp.servicios} servicio
                      {emp.servicios === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">Pagado</span>
                    <span className="block font-semibold text-primary">
                      {formatCOP(emp.totalPagado)}
                    </span>
                  </span>
                  {abiertaCarpeta ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {abiertaCarpeta && (
                  <div className="border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>Periodo</TableHead>
                          <TableHead className="text-right">Servicios</TableHead>
                          <TableHead className="text-right">Facturado</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead className="text-right">A pagar</TableHead>
                          {isStaff && <TableHead className="w-10" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {emp.liquidaciones.map((l) => {
                          const abiertaEsta = abierta === l.id;
                          return [
                            <TableRow key={l.id}>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={
                                    abiertaEsta
                                      ? "Ocultar detalle"
                                      : "Ver qué servicios hizo"
                                  }
                                  onClick={() => setAbierta(abiertaEsta ? null : l.id)}
                                >
                                  {abiertaEsta ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="whitespace-nowrap font-medium">
                                {formatFecha(l.fecha_inicio)} – {formatFecha(l.fecha_fin)}
                              </TableCell>
                              <TableCell className="text-right">{l.total_servicios}</TableCell>
                              <TableCell className="text-right">
                                {formatCOP(l.total_facturado)}
                              </TableCell>
                              <TableCell className="text-right">{l.porcentaje}%</TableCell>
                              <TableCell className="text-right font-semibold text-primary">
                                {formatCOP(l.total_pagar)}
                              </TableCell>
                              {isStaff && (
                                <TableCell className="text-right">
                                  <EliminarLiquidacionButton
                                    liquidacion={l}
                                    nombreEmpleado={emp.nombre}
                                  />
                                </TableCell>
                              )}
                            </TableRow>,
                            abiertaEsta && (
                              <TableRow
                                key={`${l.id}-detalle`}
                                className="hover:bg-transparent"
                              >
                                <TableCell
                                  colSpan={isStaff ? 7 : 6}
                                  className="bg-muted/30 p-0"
                                >
                                  <DetalleLiquidacion liquidacion={l} />
                                </TableCell>
                              </TableRow>
                            ),
                          ];
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Detalle de una liquidación: qué órdenes atendió el empleado en ese periodo y
 * qué servicios le hizo a cada una. Se reconstruye en el servidor con el mismo
 * criterio con que se liquidó (`detalle_nomina`, migración 0030).
 */
function DetalleLiquidacion({ liquidacion }: { liquidacion: NominaLiquidacion }) {
  const { data: ordenes = [], isLoading } = useQuery({
    queryKey: ["nomina", "detalle", liquidacion.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("detalle_nomina", {
        p_empleado_id: liquidacion.empleado_id,
        p_fecha_inicio: liquidacion.fecha_inicio,
        p_fecha_fin: liquidacion.fecha_fin,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return <p className="p-4 text-center text-sm text-muted-foreground">Cargando detalle…</p>;
  }
  if (ordenes.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        No hay órdenes de este empleado en el periodo.
      </p>
    );
  }

  return (
    <div className="p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {ordenes.length} orden{ordenes.length === 1 ? "" : "es"} atendida
        {ordenes.length === 1 ? "" : "s"}
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Servicios</TableHead>
              <TableHead className="text-right">Total de la orden</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenes.map((o) => (
              <TableRow key={o.orden_id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatFechaHora(o.fecha)}
                </TableCell>
                <TableCell className="font-medium">{o.placa || "—"}</TableCell>
                <TableCell>{o.servicios || "—"}</TableCell>
                <TableCell className="text-right">{formatCOP(o.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
