import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Pencil, Plus } from "lucide-react";
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
import { supabase } from "@/lib/supabase";
import type { Empleado } from "@/types/database.types";

export default function Empleados() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Empleado | null>(null);

  const { data: empleados = [] } = useQuery({
    queryKey: ["empleados", "todos"],
    queryFn: async (): Promise<Empleado[]> => {
      const { data, error } = await supabase
        .from("empleados")
        .select("*")
        .order("nombre");
      if (error) throw error;
      return data;
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["empleados"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Empleados</h2>
        <NuevoEmpleado onCreado={invalidar} />
      </div>

      <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Los empleados <strong>no inician sesión</strong> en el sistema. Son los
          trabajadores que se asignan a cada orden y sobre los que se calcula la
          comisión en <em>Nómina</em>.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {empleados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay empleados. Agrega el primero con “Nuevo empleado”.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead className="text-right">Comisión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {empleados.map((e) => (
                  <TableRow key={e.id} className={e.activo ? "" : "opacity-50"}>
                    <TableCell className="font-medium">{e.nombre}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.telefono || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.porcentaje_comision}%
                    </TableCell>
                    <TableCell>
                      {e.activo ? (
                        <Badge variant="secondary">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setEditando(e)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editando)} onOpenChange={(o) => !o && setEditando(null)}>
        {editando && (
          <EditarEmpleado
            key={editando.id}
            empleado={editando}
            onGuardado={() => {
              invalidar();
              setEditando(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function NuevoEmpleado({ onCreado }: { onCreado: () => void }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [comision, setComision] = useState("40");

  const crear = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("El nombre es obligatorio");
      const pct = Number(comision);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error("La comisión debe estar entre 0 y 100");
      const { error } = await supabase.from("empleados").insert({
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        porcentaje_comision: pct,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empleado creado");
      setNombre("");
      setTelefono("");
      setComision("40");
      setOpen(false);
      onCreado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo crear", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Nuevo empleado
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo empleado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ne-nombre">Nombre</Label>
              <Input
                id="ne-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre del trabajador"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ne-tel">Teléfono (opcional)</Label>
              <Input
                id="ne-tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="300 000 0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ne-com">Porcentaje de comisión (%)</Label>
              <Input
                id="ne-com"
                type="number"
                min={0}
                max={100}
                value={comision}
                onChange={(e) => setComision(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => crear.mutate()} disabled={crear.isPending}>
              {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditarEmpleado({
  empleado,
  onGuardado,
}: {
  empleado: Empleado;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(empleado.nombre);
  const [telefono, setTelefono] = useState(empleado.telefono ?? "");
  const [comision, setComision] = useState(String(empleado.porcentaje_comision));
  const [activo, setActivo] = useState(empleado.activo);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("El nombre es obligatorio");
      const pct = Number(comision);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error("La comisión debe estar entre 0 y 100");
      const { error } = await supabase
        .from("empleados")
        .update({
          nombre: nombre.trim(),
          telefono: telefono.trim() || null,
          porcentaje_comision: pct,
          activo,
        })
        .eq("id", empleado.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empleado actualizado");
      onGuardado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar empleado</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ee-nombre">Nombre</Label>
          <Input
            id="ee-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ee-tel">Teléfono (opcional)</Label>
          <Input
            id="ee-tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ee-com">Porcentaje de comisión (%)</Label>
          <Input
            id="ee-com"
            type="number"
            min={0}
            max={100}
            value={comision}
            onChange={(e) => setComision(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Empleado activo
        </label>
      </div>
      <DialogFooter>
        <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
          {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
