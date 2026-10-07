import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatCOP, formatFecha } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useEmpleados } from "@/hooks/queries";
import type { Prestamo, PrestamoAbono } from "@/types/database.types";

/** Fecha local YYYY-MM-DD (no usar toISOString: en Colombia salta de día). */
function hoyISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Un trabajador con sus préstamos y lo que debe. */
interface Carpeta {
  empleadoId: string;
  nombre: string;
  prestado: number;
  abonado: number;
  saldo: number;
  prestamos: Prestamo[];
}

/**
 * Préstamos a trabajadores: lo que se les prestó, lo que han abonado y lo que
 * queda debiendo.
 *
 * Es un control aparte, como un cuaderno: NO mueve la caja del negocio ni la
 * nómina (migración 0042). Ni prestar ni abonar generan movimientos.
 */
export default function Prestamos() {
  const queryClient = useQueryClient();
  const { data: empleados = [] } = useEmpleados();
  // Incluye inactivos: un trabajador que se fue puede seguir debiendo.
  const { data: todosLosEmpleados = [] } = useEmpleados(false);

  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Prestamo | null>(null);
  const [abonando, setAbonando] = useState<Prestamo | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [carpetas, setCarpetas] = useState<Set<string>>(new Set());
  const [soloConSaldo, setSoloConSaldo] = useState(true);

  const alternarCarpeta = (id: string) =>
    setCarpetas((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const { data: prestamos = [], isLoading } = useQuery({
    queryKey: ["prestamos", "lista"],
    queryFn: async (): Promise<Prestamo[]> => {
      const { data, error } = await supabase
        .from("prestamos")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const { data: abonos = [] } = useQuery({
    queryKey: ["prestamos", "abonos"],
    queryFn: async (): Promise<PrestamoAbono[]> => {
      const { data, error } = await supabase
        .from("prestamo_abonos")
        .select("*")
        .order("fecha", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["prestamos"] });
  };

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of todosLosEmpleados) m.set(e.id, e.nombre);
    return m;
  }, [todosLosEmpleados]);

  /** Abonos de cada préstamo, del más nuevo al más viejo. */
  const abonosPorPrestamo = useMemo(() => {
    const m = new Map<string, PrestamoAbono[]>();
    for (const a of abonos) {
      const lista = m.get(a.prestamo_id);
      if (lista) lista.push(a);
      else m.set(a.prestamo_id, [a]);
    }
    return m;
  }, [abonos]);

  const abonadoDe = (prestamoId: string) =>
    (abonosPorPrestamo.get(prestamoId) ?? []).reduce((acc, a) => acc + Number(a.monto), 0);

  const saldoDe = (p: Prestamo) => Number(p.monto) - abonadoDe(p.id);

  // Una carpeta por trabajador, alfabética, con sus préstamos adentro.
  const porEmpleado = useMemo(() => {
    const m = new Map<string, Prestamo[]>();
    for (const p of prestamos) {
      const lista = m.get(p.empleado_id);
      if (lista) lista.push(p);
      else m.set(p.empleado_id, [p]);
    }
    const lista: Carpeta[] = [...m.entries()].map(([empleadoId, ps]) => {
      const prestado = ps.reduce((acc, p) => acc + Number(p.monto), 0);
      const abonado = ps.reduce((acc, p) => acc + abonadoDe(p.id), 0);
      return {
        empleadoId,
        nombre: nombrePorId.get(empleadoId) ?? "Trabajador eliminado",
        prestado,
        abonado,
        saldo: prestado - abonado,
        prestamos: ps,
      };
    });
    return lista
      .filter((c) => !soloConSaldo || c.saldo > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    // abonadoDe depende de abonosPorPrestamo, que ya está en las dependencias.
  }, [prestamos, abonosPorPrestamo, nombrePorId, soloConSaldo]);

  const totales = useMemo(() => {
    const prestado = porEmpleado.reduce((acc, c) => acc + c.prestado, 0);
    const abonado = porEmpleado.reduce((acc, c) => acc + c.abonado, 0);
    return { prestado, abonado, saldo: prestado - abonado };
  }, [porEmpleado]);

  const eliminarPrestamo = useMutation({
    mutationFn: async (prestamo: Prestamo) => {
      const { error } = await supabase.rpc("eliminar_prestamo", { p_id: prestamo.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Préstamo eliminado");
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo eliminar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  const eliminarAbono = useMutation({
    mutationFn: async (abono: PrestamoAbono) => {
      const { error } = await supabase.rpc("eliminar_abono", { p_id: abono.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Abono eliminado");
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo eliminar el abono", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Préstamos a trabajadores</h2>
          <p className="text-xs text-muted-foreground">
            Control de quién debe cuánto. <strong>No toca la caja</strong> ni la
            nómina: es solo el registro de los préstamos y sus abonos.
          </p>
        </div>
        <Button onClick={() => setNuevo(true)}>
          <Plus className="h-4 w-4" />
          Nuevo préstamo
        </Button>
      </div>

      {/* Lo que se está viendo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalTile titulo="Trabajadores" texto={String(porEmpleado.length)} />
        <TotalTile titulo="Prestado" texto={formatCOP(totales.prestado)} />
        <TotalTile
          titulo="Abonado"
          texto={formatCOP(totales.abonado)}
          className="text-emerald-600"
        />
        <TotalTile
          titulo="Deben"
          texto={formatCOP(totales.saldo)}
          className={totales.saldo > 0 ? "text-destructive" : "text-primary"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={soloConSaldo ? "secondary" : "ghost"}
          size="sm"
          className="text-muted-foreground"
          onClick={() => setSoloConSaldo((v) => !v)}
        >
          {soloConSaldo ? "Viendo solo los que deben" : "Viendo todos"}
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Cargando…
          </CardContent>
        </Card>
      ) : porEmpleado.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {prestamos.length === 0
              ? "Aún no hay préstamos registrados."
              : "Ningún trabajador tiene saldo pendiente."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {porEmpleado.map((emp) => {
            const abiertaCarpeta = carpetas.has(emp.empleadoId);
            return (
              <Card key={emp.empleadoId} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => alternarCarpeta(emp.empleadoId)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                    <HandCoins className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{emp.nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      {emp.prestamos.length} préstamo
                      {emp.prestamos.length === 1 ? "" : "s"} · abonado{" "}
                      {formatCOP(emp.abonado)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">Debe</span>
                    <span
                      className={`block font-semibold ${
                        emp.saldo > 0 ? "text-destructive" : "text-emerald-600"
                      }`}
                    >
                      {formatCOP(emp.saldo)}
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
                          <TableHead>Fecha</TableHead>
                          <TableHead>Concepto</TableHead>
                          <TableHead className="text-right">Préstamo</TableHead>
                          <TableHead className="text-right">Abonado</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {emp.prestamos.map((p) => {
                          const abonadoP = abonadoDe(p.id);
                          const saldo = saldoDe(p);
                          const lista = abonosPorPrestamo.get(p.id) ?? [];
                          const abiertoEste = abierto === p.id;
                          return [
                            <TableRow key={p.id}>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={abiertoEste ? "Ocultar abonos" : "Ver abonos"}
                                  onClick={() => setAbierto(abiertoEste ? null : p.id)}
                                >
                                  {abiertoEste ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatFecha(p.fecha)}
                              </TableCell>
                              <TableCell>{p.concepto || "—"}</TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCOP(p.monto)}
                              </TableCell>
                              <TableCell className="text-right text-emerald-600">
                                {formatCOP(abonadoP)}
                              </TableCell>
                              <TableCell
                                className={`text-right font-semibold ${
                                  saldo > 0 ? "text-destructive" : "text-emerald-600"
                                }`}
                              >
                                {saldo > 0 ? formatCOP(saldo) : "Pagado"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={saldo <= 0}
                                    title={
                                      saldo <= 0
                                        ? "Este préstamo ya está pagado"
                                        : "Registrar un abono"
                                    }
                                    onClick={() => setAbonando(p)}
                                  >
                                    <Wallet className="h-3.5 w-3.5" />
                                    Abonar
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Editar préstamo"
                                    onClick={() => setEditando(p)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        title="Eliminar préstamo"
                                        className="text-destructive hover:text-destructive"
                                        disabled={eliminarPrestamo.isPending}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          ¿Eliminar el préstamo de {emp.nombre}?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Se borran también sus abonos. No afecta la
                                          caja: los préstamos son un registro aparte.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          onClick={() => eliminarPrestamo.mutate(p)}
                                        >
                                          Sí, eliminar
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </TableCell>
                            </TableRow>,
                            abiertoEste && (
                              <TableRow key={`${p.id}-abonos`} className="hover:bg-transparent">
                                <TableCell colSpan={7} className="bg-muted/30 p-4">
                                  {lista.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                      Todavía no ha abonado nada.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {lista.map((a) => (
                                        <div
                                          key={a.id}
                                          className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-2 text-sm"
                                        >
                                          <span className="w-28 text-muted-foreground">
                                            {formatFecha(a.fecha)}
                                          </span>
                                          <span className="font-medium">
                                            {formatCOP(a.monto)}
                                          </span>
                                          {/* Marca solo los abonos viejos que se
                                              descontaron en una liquidación. */}
                                          {a.origen === "nomina" && (
                                            <Badge variant="outline">
                                              Descontado en nómina
                                            </Badge>
                                          )}
                                          <span className="flex-1" />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            disabled={
                                              a.origen === "nomina" ||
                                              eliminarAbono.isPending
                                            }
                                            title={
                                              a.origen === "nomina"
                                                ? "Se descontó en una liquidación: elimina esa liquidación"
                                                : "Eliminar abono"
                                            }
                                            onClick={() => eliminarAbono.mutate(a)}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
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
          })}
        </div>
      )}

      {(nuevo || editando) && (
        <PrestamoDialog
          key={editando?.id ?? "nuevo"}
          prestamo={editando}
          empleados={empleados}
          onClose={() => {
            setNuevo(false);
            setEditando(null);
          }}
          onGuardado={invalidar}
        />
      )}

      {abonando && (
        <AbonoDialog
          key={abonando.id}
          prestamo={abonando}
          saldo={saldoDe(abonando)}
          nombre={nombrePorId.get(abonando.empleado_id) ?? "el trabajador"}
          onClose={() => setAbonando(null)}
          onGuardado={invalidar}
        />
      )}
    </div>
  );
}

function TotalTile({
  titulo,
  texto,
  className,
}: {
  titulo: string;
  texto: string;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={`mt-0.5 text-lg font-bold ${className ?? ""}`}>{texto}</p>
      </CardContent>
    </Card>
  );
}

/** Alta y edición de un préstamo. Solo registro: no mueve la caja. */
function PrestamoDialog({
  prestamo,
  empleados,
  onClose,
  onGuardado,
}: {
  prestamo: Prestamo | null;
  empleados: { id: string; nombre: string }[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [empleadoId, setEmpleadoId] = useState(prestamo?.empleado_id ?? "");
  const [monto, setMonto] = useState(prestamo ? String(prestamo.monto) : "");
  const [fecha, setFecha] = useState(prestamo?.fecha ?? hoyISO());
  const [concepto, setConcepto] = useState(prestamo?.concepto ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error("Selecciona el trabajador");
      const valor = Number(monto);
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Monto inválido");
      if (!fecha) throw new Error("La fecha es obligatoria");

      const { error } = await supabase.rpc("guardar_prestamo", {
        p_id: prestamo?.id ?? null,
        p_empleado_id: empleadoId,
        p_monto: valor,
        p_fecha: fecha,
        p_concepto: concepto.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(prestamo ? "Préstamo actualizado" : "Préstamo registrado");
      onGuardado();
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
          <DialogTitle>{prestamo ? "Editar préstamo" : "Nuevo préstamo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Trabajador</Label>
            <Select value={empleadoId} onValueChange={setEmpleadoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-monto">Monto</Label>
              <Input
                id="p-monto"
                type="number"
                min={0}
                placeholder="0"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-fecha">Fecha</Label>
              <Input
                id="p-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-concepto">Motivo (opcional)</Label>
            <Input
              id="p-concepto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: adelanto · medicamentos"
            />
          </div>

          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Queda solo en este registro: <strong>no sale de la caja</strong>. A medida
            que el trabajador vaya pagando, le registras los abonos acá.
          </p>
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

/** Abono a un préstamo. Solo registro: no entra plata a la caja. */
function AbonoDialog({
  prestamo,
  saldo,
  nombre,
  onClose,
  onGuardado,
}: {
  prestamo: Prestamo;
  saldo: number;
  nombre: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [monto, setMonto] = useState(String(saldo));
  const [fecha, setFecha] = useState(hoyISO());

  const abonar = useMutation({
    mutationFn: async () => {
      const valor = Number(monto);
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Monto inválido");
      if (valor > saldo) throw new Error(`El abono supera el saldo (${formatCOP(saldo)})`);

      const { error } = await supabase.rpc("abonar_prestamo", {
        p_prestamo_id: prestamo.id,
        p_monto: valor,
        p_fecha: fecha,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Abono registrado");
      onGuardado();
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo abonar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abono de {nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Saldo pendiente de este préstamo:{" "}
            <strong className="text-destructive">{formatCOP(saldo)}</strong>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="a-monto">Monto</Label>
              <Input
                id="a-monto"
                type="number"
                min={0}
                max={saldo}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-fecha">Fecha</Label>
              <Input
                id="a-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
          </div>

          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Queda solo en este registro: <strong>no entra a la caja</strong>. Baja lo
            que el trabajador debe.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => abonar.mutate()} disabled={abonar.isPending}>
            {abonar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar abono
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
