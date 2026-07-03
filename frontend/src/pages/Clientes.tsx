import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Pencil, Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCOP, formatFechaHora } from "@/lib/format";
import { CLASE_ESTADO, LABEL_ESTADO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useClientes } from "@/hooks/queries";
import type { Cliente, Orden } from "@/types/database.types";

export default function Clientes() {
  const queryClient = useQueryClient();
  const { data: clientes = [] } = useClientes();
  const [historialDe, setHistorialDe] = useState<Cliente | null>(null);
  const [editandoDe, setEditandoDe] = useState<Cliente | null>(null);

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["clientes"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Clientes</h2>
        <NuevoCliente onCreado={invalidar} />
      </div>

      <Card>
        <CardContent className="p-0">
          {clientes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay clientes registrados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell className="text-muted-foreground">{c.telefono || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditandoDe(c)}>
                          <Pencil className="h-4 w-4" />
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setHistorialDe(c)}>
                          <History className="h-4 w-4" />
                          Historial
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditarCliente
        key={editandoDe?.id}
        cliente={editandoDe}
        onClose={() => setEditandoDe(null)}
        onGuardado={invalidar}
      />
      <HistorialCliente cliente={historialDe} onClose={() => setHistorialDe(null)} />
    </div>
  );
}

function EditarCliente({
  cliente,
  onClose,
  onGuardado,
}: {
  cliente: Cliente | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      if (!cliente) return;
      if (!nombre.trim()) throw new Error("Nombre requerido");
      const { data, error } = await supabase
        .from("clientes")
        .update({ nombre: nombre.trim(), telefono: telefono.trim() || null })
        .eq("id", cliente.id)
        .select();
      if (error) throw error;
      // Con RLS, un update sin permiso afecta 0 filas SIN lanzar error.
      // Lo detectamos para no mostrar un falso "guardado".
      if (!data || data.length === 0) {
        throw new Error(
          "No se pudo editar (sin permiso). Falta aplicar la migración 0009 en Supabase.",
        );
      }
    },
    onSuccess: () => {
      toast.success("Cliente actualizado");
      onGuardado();
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open={Boolean(cliente)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ec-nombre">Nombre</Label>
            <Input id="ec-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-tel">Teléfono</Label>
            <Input id="ec-tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NuevoCliente({ onCreado }: { onCreado: () => void }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Nombre requerido");
      const { error } = await supabase
        .from("clientes")
        .insert({ nombre: nombre.trim(), telefono: telefono.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente agregado");
      setNombre("");
      setTelefono("");
      setOpen(false);
      onCreado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo agregar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Nuevo cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nc-nombre">Nombre</Label>
            <Input id="nc-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-tel">Teléfono</Label>
            <Input id="nc-tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
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
  );
}

function HistorialCliente({
  cliente,
  onClose,
}: {
  cliente: Cliente | null;
  onClose: () => void;
}) {
  const { data: ordenes = [], isLoading } = useQuery({
    queryKey: ["ordenes", "cliente", cliente?.id],
    enabled: Boolean(cliente),
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .eq("cliente_id", cliente!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <Dialog open={Boolean(cliente)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historial de {cliente?.nombre}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : ordenes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin órdenes registradas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Placa</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((o) => (
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
                  <TableCell className="text-right font-medium">{formatCOP(o.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
