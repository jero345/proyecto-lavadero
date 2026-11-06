import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Printer,
  Wallet,
  X,
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
import { METODOS_PAGO, pagoQuincena, quincenasDelMes } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import {
  imprimirComprobanteNomina,
  imprimirReporteNomina,
} from "@/lib/recibo-nomina";
import { useEmpleados } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { EliminarLiquidacionButton } from "@/components/EliminarLiquidacionButton";
import { AvisoNominaPendiente } from "@/components/AvisoNominaPendiente";
import type { Empleado, MetodoPago, NominaLiquidacion } from "@/types/database.types";

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
  const { isStaff } = useAuth();
  const { data: activos = [] } = useEmpleados();
  // Los de salario fijo (Diego) no ganan comisión: van en su nómina aparte.
  const empleados = useMemo(
    () => activos.filter((e) => e.tipo_pago !== "salario"),
    [activos],
  );
  const asalariados = useMemo(
    () => activos.filter((e) => e.tipo_pago === "salario"),
    [activos],
  );
  // Incluye inactivos: sus liquidaciones viejas tienen que seguir con nombre.
  const { data: todosLosEmpleados = [] } = useEmpleados(false);

  const [empleadoId, setEmpleadoId] = useState("");
  const [inicio, setInicio] = useState(primerDiaDelMes());
  const [fin, setFin] = useState(hoyISO());
  // Liquidación abierta: muestra qué servicios hizo el empleado en ese periodo.
  const [abierta, setAbierta] = useState<string | null>(null);
  // Consulta de un periodo SIN liquidar (solo para mirar el trabajo hecho).
  const [consulta, setConsulta] = useState<{
    empleadoId: string;
    inicio: string;
    fin: string;
  } | null>(null);
  // Liquidación que se está imprimiendo (para el spinner del botón).
  const [imprimiendoId, setImprimiendoId] = useState<string | null>(null);
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
        soloSalario: ls.every((l) => l.tipo === "salario"),
        // Lo pagado de verdad: la comisión menos lo que se le descontó de préstamos.
        totalPagado: ls.reduce(
          (acc, l) => acc + Number(l.total_pagar) - Number(l.abono_prestamo),
          0,
        ),
        servicios: ls.reduce((acc, l) => acc + Number(l.total_servicios), 0),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [liquidaciones, nombrePorId]);

  // Comprobante del trabajador: qué hizo en el periodo y cuánto se le paga.
  async function imprimirComprobante(l: NominaLiquidacion, nombre: string) {
    setImprimiendoId(l.id);
    try {
      await imprimirComprobanteNomina(l, nombre);
    } catch (e) {
      toast.error("No se pudo generar el comprobante", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setImprimiendoId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Quiénes trabajaron hoy y todavía no tienen su liquidación del día. */}
      <AvisoNominaPendiente enlazar={false} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nómina del trabajador</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
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
            {/* Solo reporte: muestra el trabajo del periodo sin liquidar
                nada ni tocar la caja. */}
            <Button
              variant="outline"
              title="Ver cuánto ha hecho el trabajador entre las dos fechas, sin liquidar"
              onClick={() => {
                if (!empleadoId) {
                  toast.error("Selecciona un empleado");
                  return;
                }
                setConsulta({ empleadoId, inicio, fin });
              }}
            >
              <FileText className="h-4 w-4" />
              Sacar reporte
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <strong>Sacar reporte</strong> solo muestra qué hizo el trabajador entre
            las dos fechas: no liquida ni toca la caja. Para <strong>pagar</strong>,
            marca abajo los días que se le pagan (uno, toda la semana…): el monto se
            registra como egreso en la caja principal y un día no se paga dos veces.
          </p>

          {empleadoId && (
            <DiasPendientes
              key={empleadoId}
              empleadoId={empleadoId}
              nombre={nombrePorId.get(empleadoId) ?? "Trabajador"}
              porcentaje={
                Number(empleados.find((e) => e.id === empleadoId)?.porcentaje_comision) || 0
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Nómina aparte: trabajadores de salario fijo, se pagan por quincena. */}
      {asalariados.length > 0 && (
        <NominaSalario asalariados={asalariados} liquidaciones={liquidaciones} />
      )}

      {/* Consulta del periodo: informativa, no genera liquidación. */}
      {consulta && (
        <ResumenPeriodo
          key={`${consulta.empleadoId}-${consulta.inicio}-${consulta.fin}`}
          empleadoId={consulta.empleadoId}
          inicio={consulta.inicio}
          fin={consulta.fin}
          nombre={nombrePorId.get(consulta.empleadoId) ?? "Trabajador"}
          porcentaje={
            Number(todosLosEmpleados.find((e) => e.id === consulta.empleadoId)
              ?.porcentaje_comision) || 0
          }
          onCerrar={() => setConsulta(null)}
        />
      )}

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
                      {emp.soloSalario ? (
                        <>
                          {emp.liquidaciones.length} quincena
                          {emp.liquidaciones.length === 1 ? "" : "s"} pagada
                          {emp.liquidaciones.length === 1 ? "" : "s"} · salario fijo
                        </>
                      ) : (
                        <>
                          {emp.liquidaciones.length} liquidación
                          {emp.liquidaciones.length === 1 ? "" : "es"} · {emp.servicios} servicio
                          {emp.servicios === 1 ? "" : "s"}
                        </>
                      )}
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
                          {/* Imprimir comprobante (todos) · Eliminar (solo staff) */}
                          <TableHead className="w-10" />
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
                                {l.dias && (
                                  <span className="block text-xs font-normal text-muted-foreground">
                                    {l.dias.length} día{l.dias.length === 1 ? "" : "s"} elegido
                                    {l.dias.length === 1 ? "" : "s"}
                                  </span>
                                )}
                              </TableCell>
                              {l.tipo === "salario" ? (
                                <TableCell
                                  colSpan={3}
                                  className="text-right text-muted-foreground"
                                >
                                  Quincena de salario fijo
                                </TableCell>
                              ) : (
                                <>
                                  <TableCell className="text-right">
                                    {l.total_servicios}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCOP(l.total_facturado)}
                                  </TableCell>
                                  <TableCell className="text-right">{l.porcentaje}%</TableCell>
                                </>
                              )}
                              <TableCell className="text-right font-semibold text-primary">
                                {formatCOP(
                                  Number(l.total_pagar) - Number(l.abono_prestamo),
                                )}
                                {Number(l.abono_prestamo) > 0 && (
                                  <span className="block text-xs font-normal text-muted-foreground">
                                    {formatCOP(l.total_pagar)} − {formatCOP(l.abono_prestamo)}{" "}
                                    de préstamo
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={imprimiendoId === l.id}
                                  title="Imprimir el comprobante del trabajador"
                                  onClick={() => void imprimirComprobante(l, emp.nombre)}
                                >
                                  {imprimiendoId === l.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Printer className="h-4 w-4" />
                                  )}
                                </Button>
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
                                  colSpan={isStaff ? 8 : 7}
                                  className="bg-muted/30 p-0"
                                >
                                  <DetalleOrdenes
                                    empleadoId={l.empleado_id}
                                    inicio={l.fecha_inicio}
                                    fin={l.fecha_fin}
                                    dias={l.dias}
                                  />
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
 * Días trabajados que todavía no se le pagan al trabajador. Se marcan los que
 * se pagan ahora (uno solo, toda la semana…) y salen en una sola liquidación y
 * un solo egreso de caja (`liquidar_nomina_dias`, migración 0045). El servidor
 * no deja pagar dos veces el mismo día.
 */
function DiasPendientes({
  empleadoId,
  nombre,
  porcentaje,
}: {
  empleadoId: string;
  nombre: string;
  porcentaje: number;
}) {
  const queryClient = useQueryClient();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");

  const { data: dias = [], isLoading } = useQuery({
    queryKey: ["nomina", "pendientes-dias", empleadoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dias_pendientes_nomina", {
        p_empleado_id: empleadoId,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const elegidos = dias.filter((d) => marcados.has(d.dia));
  const facturado = elegidos.reduce((acc, d) => acc + Number(d.total), 0);
  const aPagar = Math.round((facturado * porcentaje) / 100);
  const todos = dias.length > 0 && elegidos.length === dias.length;

  const alternar = (dia: string) =>
    setMarcados((prev) => {
      const next = new Set(prev);
      if (!next.delete(dia)) next.add(dia);
      return next;
    });

  const pagar = useMutation({
    mutationFn: async () => {
      if (elegidos.length === 0) throw new Error("Marca al menos un día");
      const { data, error } = await supabase.rpc("liquidar_nomina_dias", {
        p_empleado_id: empleadoId,
        p_dias: elegidos.map((d) => d.dia),
        p_metodo_pago: metodo,
      });
      if (error) throw error;
      return data as NominaLiquidacion;
    },
    onSuccess: (l) => {
      toast.success(`Nómina de ${nombre} pagada`, {
        description:
          l.total_pagar > 0
            ? `A pagar ${formatCOP(l.total_pagar)} · egreso registrado en caja`
            : `${l.total_servicios} servicios · sin monto a pagar`,
      });
      setMarcados(new Set());
      // La liquidación mete un egreso en la caja principal.
      queryClient.invalidateQueries({ queryKey: ["nomina"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo pagar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  if (isLoading) {
    return <p className="mt-4 text-sm text-muted-foreground">Cargando días…</p>;
  }
  if (dias.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        {nombre} no tiene días pendientes por pagar.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Marcar todos los días"
                  checked={todos}
                  onChange={() =>
                    setMarcados(todos ? new Set() : new Set(dias.map((d) => d.dia)))
                  }
                />
              </TableHead>
              <TableHead>Día sin pagar</TableHead>
              <TableHead className="text-right">Órdenes</TableHead>
              <TableHead className="text-right">Facturado</TableHead>
              <TableHead className="text-right">Comisión</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dias.map((d) => (
              <TableRow
                key={d.dia}
                className="cursor-pointer"
                onClick={() => alternar(d.dia)}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Pagar ${formatFecha(d.dia)}`}
                    checked={marcados.has(d.dia)}
                    onChange={() => alternar(d.dia)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="font-medium">{formatFecha(d.dia)}</TableCell>
                <TableCell className="text-right">{d.ordenes}</TableCell>
                <TableCell className="text-right">{formatCOP(d.total)}</TableCell>
                <TableCell className="text-right">
                  {formatCOP(Math.round((Number(d.total) * porcentaje) / 100))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm">
          {elegidos.length} día{elegidos.length === 1 ? "" : "s"} marcado
          {elegidos.length === 1 ? "" : "s"} · {porcentaje}% de {formatCOP(facturado)} ={" "}
          <strong className="text-primary">{formatCOP(aPagar)}</strong>
        </p>
        <div className="flex items-end gap-2">
          <div className="space-y-2">
            <Label>Pago con</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
              <SelectTrigger className="w-40">
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
            onClick={() => pagar.mutate()}
            disabled={pagar.isPending || elegidos.length === 0}
          >
            {pagar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="h-4 w-4" />
            )}
            Pagar días marcados
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Nómina de salario fijo: a estos trabajadores no se les paga comisión sino una
 * quincena del sueldo (salario + auxilio de transporte, dividido en dos). El
 * pago sale como egreso de la caja principal y el servidor no deja pagar dos
 * veces la misma quincena (`liquidar_salario`, migración 0044).
 */
function NominaSalario({
  asalariados,
  liquidaciones,
}: {
  asalariados: Empleado[];
  liquidaciones: NominaLiquidacion[];
}) {
  const queryClient = useQueryClient();
  const [empleadoId, setEmpleadoId] = useState(
    asalariados.length === 1 ? asalariados[0].id : "",
  );
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [quincena, setQuincena] = useState(quincenasDelMes(new Date()).actual);
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");

  const [y, m] = mes.split("-").map(Number);
  const periodo = quincenasDelMes(new Date(y, m - 1, 1)).quincenas.find(
    (q) => q.clave === quincena,
  )!;
  const empleado = asalariados.find((e) => e.id === empleadoId);
  const quincenaNormal = empleado ? pagoQuincena(empleado) : 0;
  // El monto viene con la quincena normal pero se puede cambiar al pagar
  // (faltó días, un extra…). Vacío = la quincena normal.
  const [montoEditado, setMontoEditado] = useState("");
  const monto = montoEditado === "" ? quincenaNormal : Number(montoEditado);

  // Reflejo en pantalla de la regla del servidor: una quincena se paga una vez.
  const yaPagada = liquidaciones.some(
    (l) =>
      l.tipo === "salario" &&
      l.empleado_id === empleadoId &&
      l.fecha_inicio <= periodo.fin &&
      l.fecha_fin >= periodo.inicio,
  );

  const pagar = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error("Selecciona un trabajador");
      if (!Number.isFinite(monto) || monto <= 0)
        throw new Error("El monto a pagar debe ser mayor que cero");
      const { data, error } = await supabase.rpc("liquidar_salario", {
        p_empleado_id: empleadoId,
        p_fecha_inicio: periodo.inicio,
        p_fecha_fin: periodo.fin,
        p_metodo_pago: metodo,
        p_monto: monto,
      });
      if (error) throw error;
      return data as NominaLiquidacion;
    },
    onSuccess: (l) => {
      toast.success("Quincena pagada", {
        description: `${formatCOP(l.total_pagar)} · se descuenta en el cierre de caja`,
      });
      setMontoEditado("");
      queryClient.invalidateQueries({ queryKey: ["nomina"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo pagar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-primary" />
          Nómina de salario fijo
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <div className="space-y-2">
            <Label>Trabajador</Label>
            <Select
              value={empleadoId}
              onValueChange={(v) => {
                setEmpleadoId(v);
                setMontoEditado("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {asalariados.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sal-mes">Mes</Label>
            <Input
              id="sal-mes"
              type="month"
              value={mes}
              onChange={(e) => e.target.value && setMes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Quincena</Label>
            <Select value={quincena} onValueChange={setQuincena}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quincenasDelMes(new Date(y, m - 1, 1)).quincenas.map((q) => (
                  <SelectItem key={q.clave} value={q.clave}>
                    {q.label} ({formatFecha(q.inicio)} – {formatFecha(q.fin)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pago con</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METODOS_PAGO.map((mp) => (
                  <SelectItem key={mp.value} value={mp.value}>
                    {mp.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sal-monto">Monto a pagar</Label>
            <Input
              id="sal-monto"
              type="number"
              min={0}
              disabled={!empleado}
              value={montoEditado === "" ? (empleado ? String(quincenaNormal) : "") : montoEditado}
              onChange={(e) => setMontoEditado(e.target.value)}
            />
          </div>
          <Button
            onClick={() => pagar.mutate()}
            disabled={pagar.isPending || !empleado || yaPagada}
            title={yaPagada ? "Esta quincena ya se pagó" : undefined}
          >
            {pagar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="h-4 w-4" />
            )}
            Pagar {empleado ? formatCOP(monto) : "quincena"}
          </Button>
        </div>
        {empleado && (
          <p
            className={`mt-3 text-xs ${yaPagada ? "font-medium text-amber-700" : "text-muted-foreground"}`}
          >
            {yaPagada ? (
              <>A {empleado.nombre} ya se le pagó esta quincena.</>
            ) : (
              <>
                Salario {formatCOP(empleado.salario_mensual)} + auxilio de transporte{" "}
                {formatCOP(empleado.auxilio_transporte)} al mes →{" "}
                <strong>{formatCOP(quincenaNormal)}</strong> por quincena (puedes cambiar el
                monto antes de pagar). No gana comisión, y el pago no baja el total del
                día en Caja: se descuenta en la nómina del cierre de caja.
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Consulta de un periodo: qué hizo el trabajador entre dos fechas y cuánto le
 * correspondería, SIN liquidar. No inserta liquidación ni toca la caja; los
 * totales se calculan igual que en `liquidar_nomina` (una orden = un servicio,
 * se cuenta el total real de la orden y la comisión es el % del trabajador).
 */
function ResumenPeriodo({
  empleadoId,
  inicio,
  fin,
  nombre,
  porcentaje,
  onCerrar,
}: {
  empleadoId: string;
  inicio: string;
  fin: string;
  nombre: string;
  porcentaje: number;
  onCerrar: () => void;
}) {
  const { data: ordenes = [], isLoading } = useDetalleNomina(empleadoId, inicio, fin);
  const [imprimiendo, setImprimiendo] = useState(false);

  const facturado = ordenes.reduce((acc, o) => acc + Number(o.total), 0);
  const comision = Math.round((facturado * porcentaje) / 100);

  // Tirilla del reporte: dice que es informativa y no lleva línea de firma,
  // para que no se confunda con el comprobante de una liquidación.
  async function imprimir() {
    setImprimiendo(true);
    try {
      await imprimirReporteNomina({ empleadoId, nombre, inicio, fin, porcentaje });
    } catch (e) {
      toast.error("No se pudo generar el reporte", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setImprimiendo(false);
    }
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Reporte de {nombre}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {formatFecha(inicio)} – {formatFecha(fin)} · solo reporte, no se
            liquida nada ni se toca la caja
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={imprimiendo || isLoading}
            onClick={() => void imprimir()}
          >
            {imprimiendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Imprimir
          </Button>
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            <X className="h-4 w-4" />
            Cerrar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DatoPeriodo titulo="Órdenes" valor={isLoading ? "…" : String(ordenes.length)} />
          <DatoPeriodo
            titulo="Facturado"
            valor={isLoading ? "…" : formatCOP(facturado)}
          />
          <DatoPeriodo titulo="Comisión" valor={`${porcentaje}%`} />
          <DatoPeriodo
            titulo="Le correspondería"
            valor={isLoading ? "…" : formatCOP(comision)}
            destacado
          />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <DetalleOrdenes empleadoId={empleadoId} inicio={inicio} fin={fin} />
        </div>
      </CardContent>
    </Card>
  );
}

function DatoPeriodo({
  titulo,
  valor,
  destacado,
}: {
  titulo: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`text-lg font-bold ${destacado ? "text-primary" : ""}`}>{valor}</p>
    </div>
  );
}

/**
 * Órdenes que atendió un empleado entre dos fechas. Las arma el servidor con el
 * mismo criterio con que se liquida (`detalle_nomina`, migración 0030), así que
 * sirve igual para ver el detalle de una liquidación ya hecha que para
 * consultar un periodo SIN liquidar.
 */
function useDetalleNomina(
  empleadoId: string,
  inicio: string,
  fin: string,
  dias: string[] | null = null,
) {
  return useQuery({
    queryKey: ["nomina", "detalle", empleadoId, inicio, fin, dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("detalle_nomina", {
        p_empleado_id: empleadoId,
        p_fecha_inicio: inicio,
        p_fecha_fin: fin,
        p_dias: dias,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Tabla de las órdenes del empleado en el periodo. */
function DetalleOrdenes({
  empleadoId,
  inicio,
  fin,
  dias = null,
}: {
  empleadoId: string;
  inicio: string;
  fin: string;
  dias?: string[] | null;
}) {
  const { data: ordenes = [], isLoading } = useDetalleNomina(empleadoId, inicio, fin, dias);

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
