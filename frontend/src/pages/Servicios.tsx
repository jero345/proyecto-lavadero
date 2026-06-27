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
import { LABEL_TIPO_VEHICULO, TIPOS_VEHICULO } from "@/lib/dominio";
import { useAuth } from "@/hooks/useAuth";
import { useServicios } from "@/hooks/queries";
import type { TipoVehiculo } from "@/types/database.types";

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
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data: servicios = [] } = useServicios(false);
  const [editando, setEditando] = useState<Borrador | null>(null);

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["servicios"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Catálogo de servicios</h2>
        {isSuperAdmin && (
          <Button onClick={() => setEditando(VACIO)}>
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </Button>
        )}
      </div>

      {!isSuperAdmin && (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          Solo un <strong>super_admin</strong> puede crear o editar servicios.
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
                {isSuperAdmin && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {servicios.map((s) => (
                <TableRow key={s.id} className={s.activo ? "" : "opacity-50"}>
                  <TableCell className="text-muted-foreground">{s.categoria}</TableCell>
                  <TableCell className="font-medium">{s.nombre}</TableCell>
                  <TableCell>{LABEL_TIPO_VEHICULO[s.tipo_vehiculo]}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCOP(s.precio)}</TableCell>
                  <TableCell>
                    {s.activo ? (
                      <Badge variant="secondary">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                  {isSuperAdmin && (
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
        onClose={() => setEditando(null)}
        onGuardado={() => {
          invalidar();
          setEditando(null);
        }}
      />
    </div>
  );
}

function ServicioForm({
  borrador,
  onClose,
  onGuardado,
}: {
  borrador: Borrador | null;
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
                  {TIPOS_VEHICULO.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
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
