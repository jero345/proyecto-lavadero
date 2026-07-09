import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  History,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useAuth } from "@/hooks/useAuth";
import { useClientes } from "@/hooks/queries";
import type { Cliente, Orden } from "@/types/database.types";

/** Botón para eliminar un cliente (staff), con confirmación. */
function EliminarClienteButton({
  cliente,
  onEliminado,
}: {
  cliente: Cliente;
  onEliminado: () => void;
}) {
  const [open, setOpen] = useState(false);
  const eliminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("clientes").delete().eq("id", cliente.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente eliminado");
      onEliminado();
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error("No se pudo eliminar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Eliminar a {cliente.placa || cliente.nombre}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Las órdenes de este cliente se
            conservan, pero quedan sin cliente asociado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={eliminar.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={eliminar.isPending}
            onClick={(e) => {
              e.preventDefault();
              eliminar.mutate();
            }}
          >
            {eliminar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Normaliza un texto para comparar sin importar mayúsculas/espacios. */
function normalizar(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Traduce el error de índice único de la base (código 23505, cuando dos guardan
 * la misma placa "a la vez" y el pre-chequeo no alcanzó) a un mensaje legible.
 */
function traducirErrorCliente(
  error: { code?: string },
  placa: string,
  nombre: string,
): Error {
  if (error.code === "23505") {
    return new Error(
      placa
        ? `Ya existe un cliente con la placa ${placa}`
        : `Ya existe un cliente con el nombre "${nombre}"`,
    );
  }
  return error as unknown as Error;
}

/**
 * Bloquea clientes duplicados: si ya existe uno con la MISMA placa (o el mismo
 * nombre cuando no hay placa), lanza un error legible. `excluirId` sirve al
 * editar, para no chocar consigo mismo. Compara normalizado (sin mayúsculas ni
 * espacios) para atrapar "ABC 123" vs "abc123".
 */
async function verificarClienteDuplicado(
  placa: string,
  nombre: string,
  excluirId?: string,
): Promise<void> {
  const placaNorm = normalizar(placa);
  const nombreNorm = normalizar(nombre);

  const { data, error } = await supabase.from("clientes").select("id, placa, nombre");
  if (error) throw error;

  for (const c of data ?? []) {
    if (excluirId && c.id === excluirId) continue;
    if (placaNorm && normalizar(c.placa ?? "") === placaNorm) {
      throw new Error(`Ya existe un cliente con la placa ${placa.trim().toUpperCase()}`);
    }
    // Solo comparamos por nombre cuando el nuevo cliente NO tiene placa.
    if (!placaNorm && nombreNorm && normalizar(c.nombre ?? "") === nombreNorm) {
      throw new Error(`Ya existe un cliente con el nombre "${nombre.trim()}"`);
    }
  }
}

/**
 * Normaliza un teléfono al formato que espera wa.me (E.164 sin "+"): solo
 * dígitos, con indicativo de país. En Colombia los celulares son 10 dígitos;
 * si no traen el 57 adelante, se lo agregamos.
 */
function numeroWhatsApp(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.startsWith("57")) return digitos;
  if (digitos.length === 10) return `57${digitos}`;
  return digitos;
}

export default function Clientes() {
  const queryClient = useQueryClient();
  const { isStaff } = useAuth();
  const { data: clientes = [] } = useClientes();
  const [historialDe, setHistorialDe] = useState<Cliente | null>(null);
  const [editandoDe, setEditandoDe] = useState<Cliente | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["clientes"] });

  const clientesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      [c.placa, c.nombre, c.telefono]
        .filter(Boolean)
        .some((campo) => campo!.toLowerCase().includes(q)),
    );
  }, [clientes, busqueda]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Clientes</h2>
        <NuevoCliente onCreado={invalidar} />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por placa, nombre o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {clientes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay clientes registrados.
            </p>
          ) : clientesFiltrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Ningún cliente coincide con «{busqueda}».
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Placa</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientesFiltrados.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium uppercase">{c.placa || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.nombre && c.nombre !== c.placa ? c.nombre : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.telefono || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.telefono && (
                          <>
                            <Button asChild variant="ghost" size="sm">
                              <a href={`tel:${c.telefono.replace(/\s+/g, "")}`}>
                                <Phone className="h-4 w-4" />
                                Llamar
                              </a>
                            </Button>
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="text-green-600 hover:text-green-700"
                            >
                              <a
                                href={`https://wa.me/${numeroWhatsApp(c.telefono)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <MessageCircle className="h-4 w-4" />
                                WhatsApp
                              </a>
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditandoDe(c)}>
                          <Pencil className="h-4 w-4" />
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setHistorialDe(c)}>
                          <History className="h-4 w-4" />
                          Historial
                        </Button>
                        {isStaff && (
                          <EliminarClienteButton cliente={c} onEliminado={invalidar} />
                        )}
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
  const [placa, setPlaca] = useState(cliente?.placa ?? "");
  const [nombre, setNombre] = useState(
    cliente && cliente.nombre !== cliente.placa ? cliente.nombre : "",
  );
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      if (!cliente) return;
      const placaLimpia = placa.trim().toUpperCase();
      const nombreLimpio = nombre.trim();
      if (!placaLimpia && !nombreLimpio) throw new Error("Ingresá la placa (o el nombre)");
      // No permitir chocar con OTRO cliente ya existente (mismo placa/nombre).
      await verificarClienteDuplicado(placaLimpia, nombreLimpio, cliente.id);
      const { data, error } = await supabase
        .from("clientes")
        .update({
          nombre: nombreLimpio || placaLimpia,
          placa: placaLimpia || null,
          telefono: telefono.trim() || null,
        })
        .eq("id", cliente.id)
        .select();
      if (error) throw traducirErrorCliente(error, placaLimpia, nombreLimpio);
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
            <Label htmlFor="ec-placa">Placa</Label>
            <Input
              id="ec-placa"
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              className="uppercase"
              placeholder="ABC123"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-nombre">Nombre (opcional)</Label>
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
  const [placa, setPlaca] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      const placaLimpia = placa.trim().toUpperCase();
      const nombreLimpio = nombre.trim();
      if (!placaLimpia && !nombreLimpio) throw new Error("Ingresá la placa (o el nombre)");
      // No permitir clientes duplicados: misma placa, o mismo nombre si no hay placa.
      await verificarClienteDuplicado(placaLimpia, nombreLimpio);
      const { error } = await supabase.from("clientes").insert({
        nombre: nombreLimpio || placaLimpia,
        placa: placaLimpia || null,
        telefono: telefono.trim() || null,
      });
      if (error) throw traducirErrorCliente(error, placaLimpia, nombreLimpio);
    },
    onSuccess: () => {
      toast.success("Cliente agregado");
      setPlaca("");
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
            <Label htmlFor="nc-placa">Placa</Label>
            <Input
              id="nc-placa"
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase())}
              className="uppercase"
              placeholder="ABC123"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-nombre">Nombre (opcional)</Label>
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
