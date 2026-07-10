import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { formatCOP } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useServicios, useTiposVehiculo } from "@/hooks/queries";
import type { TipoVehiculo, TipoVehiculoRow } from "@/types/database.types";

type Borrador = {
  id?: string;
  categoria: string;
  nombre: string;
  descripcion: string;
  tipo_vehiculo: TipoVehiculo;
  precio: string;
  activo: boolean;
};

const VACIO: Borrador = {
  categoria: "",
  nombre: "",
  descripcion: "",
  tipo_vehiculo: "auto",
  precio: "",
  activo: true,
};

export default function Servicios() {
  const { isStaff } = useAuth();
  const queryClient = useQueryClient();
  const { data: servicios = [] } = useServicios(false);
  const { data: tipos = [] } = useTiposVehiculo(false);
  const [editando, setEditando] = useState<Borrador | null>(null);

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["servicios"] });

  // Etiqueta legible de un tipo (busca en el catálogo; si no, muestra el código).
  const nombreTipo = (codigo: string) =>
    tipos.find((t) => t.codigo === codigo)?.nombre ?? codigo;
  const tiposActivos = tipos.filter((t) => t.activo);

  return (
    <div className="space-y-6">
      {isStaff && <TiposVehiculoManager tipos={tipos} />}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Catálogo de servicios</h2>
        {isStaff && (
          <Button
            onClick={() =>
              setEditando({ ...VACIO, tipo_vehiculo: tiposActivos[0]?.codigo ?? "" })
            }
          >
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </Button>
        )}
      </div>

      {!isStaff && (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Solo <strong>admin</strong> o <strong>super_admin</strong> pueden crear o
          editar el catálogo.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead>Estado</TableHead>
                {isStaff && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {servicios.map((s) => (
                <TableRow key={s.id} className={s.activo ? "" : "opacity-50"}>
                  <TableCell className="text-muted-foreground">{s.categoria}</TableCell>
                  <TableCell className="font-medium">{s.nombre}</TableCell>
                  <TableCell>{nombreTipo(s.tipo_vehiculo)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCOP(s.precio)}</TableCell>
                  <TableCell>
                    {s.activo ? (
                      <Badge variant="secondary">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                  {isStaff && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setEditando({
                            id: s.id,
                            categoria: s.categoria,
                            nombre: s.nombre,
                            descripcion: s.descripcion ?? "",
                            tipo_vehiculo: s.tipo_vehiculo,
                            precio: String(s.precio),
                            activo: s.activo,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ServicioForm
        borrador={editando}
        tipos={tiposActivos}
        onClose={() => setEditando(null)}
        onGuardado={() => {
          invalidar();
          setEditando(null);
        }}
      />
    </div>
  );
}

/** Genera un código (slug) a partir del nombre: 'Moto Alto' -> 'moto_alto'. */
function slugTipo(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Gestión del catálogo de tipos de vehículo (agregar/editar, activar). */
function TiposVehiculoManager({ tipos }: { tipos: TipoVehiculoRow[] }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<TipoVehiculoRow | "nuevo" | null>(null);
  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["tipos_vehiculo"] });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tipos de vehículo</h2>
          <Button size="sm" variant="outline" onClick={() => setEditando("nuevo")}>
            <Plus className="h-4 w-4" />
            Nuevo tipo
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tipos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay tipos.</p>
          ) : (
            tipos.map((t) => (
              <button
                key={t.codigo}
                type="button"
                onClick={() => setEditando(t)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent ${
                  t.activo ? "" : "opacity-50"
                }`}
              >
                <span className="font-medium">{t.nombre}</span>
                {!t.activo && <Badge variant="outline">Inactivo</Badge>}
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </CardContent>

      {editando && (
        <TipoVehiculoForm
          tipo={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            invalidar();
            setEditando(null);
          }}
        />
      )}
    </Card>
  );
}

/** Formulario para crear/editar un tipo de vehículo. */
function TipoVehiculoForm({
  tipo,
  onClose,
  onGuardado,
}: {
  tipo: TipoVehiculoRow | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(tipo?.nombre ?? "");
  const [activo, setActivo] = useState(tipo?.activo ?? true);

  const guardar = useMutation({
    mutationFn: async () => {
      const nombreLimpio = nombre.trim();
      if (!nombreLimpio) throw new Error("El nombre es obligatorio");

      if (tipo) {
        // Editar: el código (usado por los servicios) NO cambia.
        const { error } = await supabase
          .from("tipos_vehiculo")
          .update({ nombre: nombreLimpio, activo })
          .eq("codigo", tipo.codigo);
        if (error) throw error;
      } else {
        const codigo = slugTipo(nombreLimpio);
        if (!codigo) throw new Error("Nombre inválido");
        const { error } = await supabase
          .from("tipos_vehiculo")
          .insert({ codigo, nombre: nombreLimpio, activo });
        if (error) {
          if ((error as { code?: string }).code === "23505")
            throw new Error("Ya existe un tipo de vehículo con ese nombre");
          throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("Tipo de vehículo guardado");
      onGuardado();
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
          <DialogTitle>{tipo ? "Editar tipo" : "Nuevo tipo de vehículo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Buseta, Camión, Bicicleta…"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
            />
            Activo (aparece en el POS)
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

function ServicioForm({
  borrador,
  tipos,
  onClose,
  onGuardado,
}: {
  borrador: Borrador | null;
  tipos: TipoVehiculoRow[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [draft, setDraft] = useState<Borrador>(borrador ?? VACIO);

  // Sincroniza el borrador local cuando cambia el servicio a editar.
  useEffect(() => {
    if (borrador) setDraft(borrador);
  }, [borrador]);

  const guardar = useMutation({
    mutationFn: async (current: Borrador) => {
      const payload = {
        categoria: current.categoria.trim(),
        nombre: current.nombre.trim(),
        descripcion: current.descripcion.trim() || null,
        tipo_vehiculo: current.tipo_vehiculo,
        precio: Number(current.precio),
        activo: current.activo,
      };
      if (!payload.categoria || !payload.nombre) throw new Error("Categoría y nombre requeridos");
      if (!Number.isFinite(payload.precio) || payload.precio < 0)
        throw new Error("Precio inválido");

      if (current.id) {
        const { error } = await supabase.from("servicios").update(payload).eq("id", current.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("servicios").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Servicio guardado");
      onGuardado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo guardar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open={Boolean(borrador)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft.id ? "Editar servicio" : "Nuevo servicio"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Input
                value={draft.categoria}
                onChange={(e) => setDraft({ ...draft, categoria: e.target.value })}
                placeholder="Autos, Motos, Otros…"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de vehículo</Label>
              <Select
                value={draft.tipo_vehiculo}
                onValueChange={(v) => setDraft({ ...draft, tipo_vehiculo: v as TipoVehiculo })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t.codigo} value={t.codigo}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={draft.nombre}
              onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Precio (COP)</Label>
            <Input
              type="number"
              min={0}
              value={draft.precio}
              onChange={(e) => setDraft({ ...draft, precio: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.activo}
              onChange={(e) => setDraft({ ...draft, activo: e.target.checked })}
            />
            Servicio activo
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate(draft)} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
