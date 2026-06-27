import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { subirFotoOrden } from "@/lib/storage";
import { TIPOS_VEHICULO, METODOS_PAGO } from "@/lib/dominio";
import { useAuth } from "@/hooks/useAuth";
import { useClientes, useEmpleados, useServicios } from "@/hooks/queries";
import type { MetodoPago, TipoVehiculo } from "@/types/database.types";

export default function POS() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: servicios = [], isLoading: cargandoServicios } = useServicios(true);
  const { data: empleados = [] } = useEmpleados();
  const { data: clientes = [] } = useClientes();

  const [tipo, setTipo] = useState<TipoVehiculo | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [placa, setPlaca] = useState("");
  const [clienteId, setClienteId] = useState<string>("");
  const [empleadoId, setEmpleadoId] = useState<string>("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago | "">("");
  const [file, setFile] = useState<File | null>(null);

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
    setPlaca("");
    setClienteId("");
    setMetodoPago("");
    setFile(null);
    setEmpleadoId("");
  }

  const crearOrden = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sesión no válida");
      if (seleccion.size === 0) throw new Error("Selecciona al menos un servicio");
      if (!placa.trim()) throw new Error("Ingresa la placa");
      if (!empleadoId) throw new Error("Selecciona el empleado");
      // El método de pago es OPCIONAL: si no se elige, la orden queda agendada
      // (pendiente de cobro) y se cobra luego desde el Dashboard.
      const cobrada = Boolean(metodoPago);

      // Sube la foto (opcional) y obtiene su ruta.
      let fotoPath: string | null = null;
      if (file) fotoPath = await subirFotoOrden(file, profile.id);

      const { data, error } = await supabase.rpc("crear_orden", {
        p_servicio_ids: Array.from(seleccion),
        p_empleado_id: empleadoId,
        p_metodo_pago: metodoPago || null,
        p_placa: placa.trim().toUpperCase(),
        p_cliente_id: clienteId || null,
        p_vehiculo_id: null,
        p_foto_url: fotoPath,
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
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Panel izquierdo: selección */}
      <div className="space-y-6">
        {/* 1. Tipo de vehículo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Tipo de vehículo</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIPOS_VEHICULO.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => cambiarTipo(t.value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border-2 p-4 transition-colors",
                  tipo === t.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="text-2xl">{t.emoji}</span>
                <span className="text-sm font-medium">{t.label}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* 2. Servicios */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Servicios</CardTitle>
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

      {/* Panel derecho: datos + cobro (sticky) */}
      <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Datos y cobro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="placa">Placa</Label>
              <Input
                id="placa"
                placeholder="ABC123"
                value={placa}
                onChange={(e) => setPlaca(e.target.value.toUpperCase())}
                className="uppercase"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cliente (opcional)</Label>
                <NuevoClienteRapido onCreado={(id) => setClienteId(id)} />
              </div>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                      {c.telefono ? ` · ${c.telefono}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Empleado</Label>
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

            <div className="space-y-2">
              <Label>Foto del vehículo (opcional)</Label>
              <div className="flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed p-2 text-sm text-muted-foreground hover:border-primary/40">
                  <Camera className="h-4 w-4" />
                  {file ? file.name : "Tomar / subir foto"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {file && (
                  <Button variant="ghost" size="icon" onClick={() => setFile(null)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

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

        {/* Total + acción */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {seleccion.size} servicio(s)
              </span>
              <span className="text-2xl font-bold">{formatCOP(total)}</span>
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

/** Crea un cliente al instante desde el POS y lo deja seleccionado. */
function NuevoClienteRapido({ onCreado }: { onCreado: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("El nombre es obligatorio");
      const { data, error } = await supabase
        .from("clientes")
        .insert({ nombre: nombre.trim(), telefono: telefono.trim() || null })
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
              <Label htmlFor="qc-nombre">Nombre</Label>
              <Input
                id="qc-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre del cliente"
                autoFocus
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
