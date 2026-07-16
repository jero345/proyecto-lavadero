import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { formatCOP } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { METODOS_PAGO, iconoTipoVehiculo, colorTipoVehiculo } from "@/lib/dominio";
import { useAuth } from "@/hooks/useAuth";
import {
  useClientes,
  useEmpleados,
  useServicios,
  useTiposVehiculo,
} from "@/hooks/queries";
import type { Cliente, MetodoPago, TipoVehiculo } from "@/types/database.types";

export default function POS() {
  const { profile, isStaff } = useAuth();
  const queryClient = useQueryClient();

  const { data: servicios = [], isLoading: cargandoServicios } = useServicios(true);
  const { data: empleados = [] } = useEmpleados();
  const { data: clientes = [] } = useClientes();
  const { data: tiposVehiculo = [] } = useTiposVehiculo();

  const [tipo, setTipo] = useState<TipoVehiculo | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [clienteId, setClienteId] = useState<string>("");
  const [empleadoId, setEmpleadoId] = useState<string>("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago | "">("");
  const [observaciones, setObservaciones] = useState("");
  // Total editable (solo staff). null = usar el subtotal del catálogo.
  const [totalManual, setTotalManual] = useState<string | null>(null);

  // Servicios del tipo elegido, agrupados por categoría.
  const serviciosFiltrados = useMemo(
    () => servicios.filter((s) => s.tipo_vehiculo === tipo),
    [servicios, tipo],
  );
  const porCategoria = useMemo(() => {
    const map = new Map<string, typeof serviciosFiltrados>();
    for (const s of serviciosFiltrados) {
      const arr = map.get(s.categoria) ?? [];
      arr.push(s);
      map.set(s.categoria, arr);
    }
    return Array.from(map.entries());
  }, [serviciosFiltrados]);

  const total = useMemo(
    () =>
      servicios
        .filter((s) => seleccion.has(s.id))
        .reduce((acc, s) => acc + Number(s.precio), 0),
    [servicios, seleccion],
  );

  function toggleServicio(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cambiarTipo(t: TipoVehiculo) {
    setTipo(t);
    setSeleccion(new Set()); // los servicios dependen del tipo
  }

  function reset() {
    setTipo(null);
    setSeleccion(new Set());
    setClienteId("");
    setMetodoPago("");
    setObservaciones("");
    setTotalManual(null);
    setEmpleadoId("");
  }

  const crearOrden = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sesión no válida");
      if (seleccion.size === 0) throw new Error("Selecciona al menos un servicio");
      if (!empleadoId) throw new Error("Selecciona el empleado");
      // El método de pago es OPCIONAL: si no se elige, la orden queda agendada
      // (pendiente de cobro) y se cobra luego desde el Dashboard.
      const cobrada = Boolean(metodoPago);

      // Total final (override): si se editó manualmente. El servidor lo valida.
      let overrideTotal: number | null = null;
      if (totalManual !== null && totalManual.trim() !== "") {
        const n = Number(totalManual);
        if (!Number.isFinite(n) || n < 0) throw new Error("El total ingresado no es válido");
        overrideTotal = n;
      }

      // La placa se hereda del cliente seleccionado para que quede en la orden
      // (el dueño la necesita al cobrar y en el Dashboard).
      const placaCliente = clientes.find((c) => c.id === clienteId)?.placa ?? null;

      const { data, error } = await supabase.rpc("crear_orden", {
        p_servicio_ids: Array.from(seleccion),
        p_empleado_id: empleadoId,
        p_metodo_pago: metodoPago || null,
        p_placa: placaCliente,
        p_cliente_id: clienteId || null,
        p_vehiculo_id: null,
        p_foto_url: null,
        p_observaciones: observaciones.trim() || null,
        p_total_override: overrideTotal,
      });
      if (error) throw error;
      return { total: (data as { total: number }).total, cobrada };
    },
    onSuccess: ({ total, cobrada }) => {
      toast.success(cobrada ? "Orden registrada y cobrada" : "Orden agendada (pendiente de cobro)", {
        description: `Total ${formatCOP(total)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      reset();
    },
    onError: (e: unknown) => {
      toast.error("No se pudo registrar", {
        description: e instanceof Error ? e.message : "Error desconocido",
      });
    },
  });

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_360px]">
      {/* Panel izquierdo: selección. En móvil se "disuelve" (contents) para que
          el tipo de vehículo y los servicios queden primero. */}
      <div className="contents lg:block lg:space-y-6">
        {/* 1. Tipo de vehículo */}
        <Card className="order-1 lg:order-none">
          <CardHeader>
            <CardTitle className="text-base">Tipo de vehículo</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiposVehiculo.map((t, i) => {
              const activo = tipo === t.codigo;
              const Icon = iconoTipoVehiculo(t.codigo);
              return (
                <button
                  key={t.codigo}
                  type="button"
                  onClick={() => cambiarTipo(t.codigo)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                    activo
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-accent/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                      activo
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : colorTipoVehiculo(i),
                    )}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-medium">{t.nombre}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* 2. Servicios */}
        <Card className="order-2 lg:order-none">
          <CardHeader>
            <CardTitle className="text-base">Servicios</CardTitle>
          </CardHeader>
          <CardContent>
            {!tipo ? (
              <p className="text-sm text-muted-foreground">
                Elige primero el tipo de vehículo.
              </p>
            ) : cargandoServicios ? (
              <p className="text-sm text-muted-foreground">Cargando servicios…</p>
            ) : serviciosFiltrados.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay servicios para este tipo de vehículo.
              </p>
            ) : (
              <div className="space-y-5">
                {porCategoria.map(([categoria, items]) => (
                  <div key={categoria}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {categoria}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {items.map((s) => {
                        const activo = seleccion.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleServicio(s.id)}
                            className={cn(
                              "flex items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors",
                              activo
                                ? "border-primary bg-primary/5"
                                : "hover:border-primary/40",
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded border",
                                  activo
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-muted-foreground/30",
                                )}
                              >
                                {activo && <Check className="h-3.5 w-3.5" />}
                              </span>
                              <span className="text-sm font-medium">{s.nombre}</span>
                            </span>
                            <span className="text-sm font-semibold">
                              {formatCOP(s.precio)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Panel derecho: datos + cobro. En móvil van DESPUÉS de los servicios. */}
      <div className="contents lg:block lg:space-y-4 lg:sticky lg:top-0 lg:self-start">
        <Card className="order-3 lg:order-none">
          <CardHeader>
            <CardTitle className="text-base">Datos y cobro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cliente (opcional)</Label>
                <NuevoClienteRapido onCreado={(id) => setClienteId(id)} />
              </div>
              <ClientePicker
                clientes={clientes}
                value={clienteId}
                onChange={setClienteId}
              />
            </div>

            {isStaff && (
              <div className="space-y-2">
                <Label htmlFor="observaciones">Observaciones (opcional)</Label>
                <Textarea
                  id="observaciones"
                  rows={3}
                  placeholder="Notas o un servicio adicional que no está en la lista…"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Método de pago (opcional)</Label>
              <Select
                value={metodoPago || "pendiente"}
                onValueChange={(v) =>
                  setMetodoPago(v === "pendiente" ? "" : (v as MetodoPago))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendiente">Pendiente (cobrar luego)</SelectItem>
                  {METODOS_PAGO.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!metodoPago && (
                <p className="text-xs text-muted-foreground">
                  Sin método de pago la orden se <strong>agenda</strong> y se cobra
                  después desde el Dashboard.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Empleado: va de último, ya con los servicios cargados. */}
        <Card className="order-4 lg:order-none">
          <CardHeader>
            <CardTitle className="text-base">Empleado</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Total + acción */}
        <Card className="order-5 lg:order-none">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{seleccion.size} servicio(s)</span>
              <span>Subtotal {formatCOP(total)}</span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="total-final">Total a cobrar</Label>
                {totalManual !== null && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setTotalManual(null)}
                  >
                    Usar subtotal
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                  $
                </span>
                <Input
                  id="total-final"
                  type="number"
                  min={0}
                  value={totalManual ?? String(total)}
                  onChange={(e) => setTotalManual(e.target.value)}
                  className="h-12 pl-7 text-right text-2xl font-bold"
                />
              </div>
              {totalManual !== null && Number(totalManual) !== total && (
                <p className="text-xs text-amber-600">
                  Total ajustado (subtotal del catálogo: {formatCOP(total)}).
                </p>
              )}
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={crearOrden.isPending}
              onClick={() => crearOrden.mutate()}
            >
              {crearOrden.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {metodoPago ? "Registrar y cobrar" : "Agendar (cobrar luego)"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Identificador principal del cliente: la PLACA (o el nombre si no tiene). */
function etiquetaCliente(c: Cliente): string {
  return c.placa || c.nombre;
}
/** Datos secundarios (nombre distinto de la placa + teléfono). */
function subtituloCliente(c: Cliente): string {
  const partes: string[] = [];
  if (c.placa && c.nombre && c.nombre !== c.placa) partes.push(c.nombre);
  if (c.telefono) partes.push(c.telefono);
  return partes.join(" · ");
}

/**
 * Selector de cliente con buscador. El dueño busca por PLACA (también por nombre
 * o teléfono). Muestra la placa como identificador principal.
 */
function ClientePicker({
  clientes,
  value,
  onChange,
}: {
  clientes: Cliente[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const seleccionado = clientes.find((c) => c.id === value) ?? null;

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      [c.placa, c.nombre, c.telefono]
        .filter(Boolean)
        .some((campo) => campo!.toLowerCase().includes(q)),
    );
  }, [clientes, busqueda]);

  function elegir(id: string) {
    onChange(id);
    setOpen(false);
    setBusqueda("");
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between font-normal"
        onClick={() => setOpen(true)}
      >
        <span className={cn("truncate", !seleccionado && "text-muted-foreground")}>
          {seleccionado
            ? `${etiquetaCliente(seleccionado)}${seleccionado.telefono ? ` · ${seleccionado.telefono}` : ""}`
            : "Cliente creado"}
        </span>
        <span className="flex items-center gap-1">
          {seleccionado && (
            <X
              className="h-4 w-4 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
            />
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setBusqueda("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar cliente</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Placa, nombre o teléfono…"
              className="pl-8 uppercase"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => elegir("")}
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Sin cliente
            </button>
            {filtrados.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No se encontraron clientes.
              </p>
            ) : (
              filtrados.map((c) => {
                const sub = subtituloCliente(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => elegir(c.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                      c.id === value && "bg-accent",
                    )}
                  >
                    <span className="truncate font-medium uppercase">
                      {etiquetaCliente(c)}
                    </span>
                    {sub && (
                      <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Crea un cliente al instante desde el POS y lo deja seleccionado. */
function NuevoClienteRapido({ onCreado }: { onCreado: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [placa, setPlaca] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      const placaLimpia = placa.trim().toUpperCase();
      const nombreLimpio = nombre.trim();
      // La placa es lo principal; el nombre es opcional. Debe haber al menos uno.
      if (!placaLimpia && !nombreLimpio) throw new Error("Ingresá la placa (o el nombre)");
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          // Si no hay nombre, usamos la placa como nombre (la columna es NOT NULL).
          nombre: nombreLimpio || placaLimpia,
          placa: placaLimpia || null,
          telefono: telefono.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (cliente) => {
      toast.success("Cliente creado");
      // Refresca la lista y deja al nuevo cliente seleccionado en la orden.
      await queryClient.invalidateQueries({ queryKey: ["clientes"] });
      onCreado(cliente.id);
      setPlaca("");
      setNombre("");
      setTelefono("");
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error("No se pudo crear el cliente", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Nuevo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qc-placa">Placa</Label>
              <Input
                id="qc-placa"
                value={placa}
                onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="uppercase"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-nombre">Nombre (opcional)</Label>
              <Input
                id="qc-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-tel">Teléfono (opcional)</Label>
              <Input
                id="qc-tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="300 000 0000"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => crear.mutate()} disabled={crear.isPending}>
              {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
