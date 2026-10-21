import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { AUXILIO_TRANSPORTE, SMMLV, pagoQuincena } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Empleado, TipoPago } from "@/types/database.types";

/**
 * Fecha local en formato YYYY-MM-DD. No usar toISOString() (convierte a UTC y
 * en Colombia devuelve el día anterior de noche).
 */
function fechaLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Empleados() {
  const queryClient = useQueryClient();
  const { isStaff } = useAuth();
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
                  <TableHead>Ingreso</TableHead>
                  <TableHead className="text-right">Comisión</TableHead>
                  <TableHead>Observaciones</TableHead>
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
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFecha(e.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.tipo_pago === "salario" ? (
                        <span className="whitespace-nowrap" title="Salario + auxilio, por quincena">
                          Salario fijo · {formatCOP(pagoQuincena(e))}/quincena
                        </span>
                      ) : (
                        `${e.porcentaje_comision}%`
                      )}
                    </TableCell>
                    {/* Notas largas: se recortan y el texto completo va en el title. */}
                    <TableCell
                      className="max-w-[220px] truncate text-muted-foreground"
                      title={e.observaciones ?? undefined}
                    >
                      {e.observaciones || "—"}
                    </TableCell>
                    <TableCell>
                      {e.activo ? (
                        <Badge variant="secondary">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditando(e)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isStaff && (
                          <EliminarEmpleadoButton empleado={e} onEliminado={invalidar} />
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

/**
 * Botón para eliminar un empleado (staff). Si el empleado ya tiene órdenes o
 * nómina, la base lo impide (FK): mostramos un mensaje claro sugiriendo
 * desactivarlo en su lugar (conserva el historial).
 */
function EliminarEmpleadoButton({
  empleado,
  onEliminado,
}: {
  empleado: Empleado;
  onEliminado: () => void;
}) {
  const [open, setOpen] = useState(false);
  const eliminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("empleados").delete().eq("id", empleado.id);
      if (error) {
        // 23503 = FK: el empleado está referenciado en órdenes/nómina.
        if ((error as { code?: string }).code === "23503") {
          throw new Error(
            "Tiene órdenes o nómina registradas. Desactívalo (en Editar) en vez de eliminarlo.",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Empleado eliminado");
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
          size="icon"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          title="Eliminar empleado"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar a {empleado.nombre}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Si el empleado ya trabajó en órdenes
            o tiene nómina, no se podrá eliminar (mejor desactivarlo).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={eliminar.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={eliminar.isPending}
            onClick={(ev) => {
              ev.preventDefault();
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

function NuevoEmpleado({ onCreado }: { onCreado: () => void }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [comision, setComision] = useState("40");
  const [pago, setPago] = useState<DatosPago>(PAGO_POR_DEFECTO);
  const [observaciones, setObservaciones] = useState("");

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
        ...validarPago(pago),
        observaciones: observaciones.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empleado creado");
      setNombre("");
      setTelefono("");
      setComision("40");
      setPago(PAGO_POR_DEFECTO);
      setObservaciones("");
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
            <CamposPago pago={pago} onChange={setPago} />
            {pago.tipo_pago === "comision" && (
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
            )}
            <div className="space-y-2">
              <Label htmlFor="ne-obs">Observaciones (opcional)</Label>
              <Textarea
                id="ne-obs"
                rows={3}
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Horario, acuerdos, documentos pendientes…"
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
  const [pago, setPago] = useState<DatosPago>(
    empleado.tipo_pago === "salario"
      ? {
          tipo_pago: "salario",
          salario: String(empleado.salario_mensual),
          auxilio: String(empleado.auxilio_transporte),
        }
      : PAGO_POR_DEFECTO,
  );
  const [observaciones, setObservaciones] = useState(empleado.observaciones ?? "");
  const [activo, setActivo] = useState(empleado.activo);
  const fechaIngresoInicial = fechaLocalISO(new Date(empleado.created_at));
  const [fechaIngreso, setFechaIngreso] = useState(fechaIngresoInicial);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("El nombre es obligatorio");
      const pct = Number(comision);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100)
        throw new Error("La comisión debe estar entre 0 y 100");

      const cambios: {
        nombre: string;
        telefono: string | null;
        porcentaje_comision: number;
        tipo_pago: TipoPago;
        salario_mensual: number;
        auxilio_transporte: number;
        observaciones: string | null;
        activo: boolean;
        created_at?: string;
      } = {
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        porcentaje_comision: pct,
        ...validarPago(pago),
        observaciones: observaciones.trim() || null,
        activo,
      };
      // Solo tocamos la fecha de ingreso si el usuario la cambió. Se guarda al
      // mediodía local para que se muestre el mismo día sin correrse por zona
      // horaria.
      if (fechaIngreso && fechaIngreso !== fechaIngresoInicial) {
        const [y, m, d] = fechaIngreso.split("-").map(Number);
        cambios.created_at = new Date(y, m - 1, d, 12, 0, 0).toISOString();
      }

      const { error } = await supabase
        .from("empleados")
        .update(cambios)
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
        <CamposPago pago={pago} onChange={setPago} />
        {pago.tipo_pago === "comision" && (
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
        )}
        <div className="space-y-2">
          <Label htmlFor="ee-obs">Observaciones</Label>
          <Textarea
            id="ee-obs"
            rows={3}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Horario, acuerdos, documentos pendientes…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ee-ingreso">Fecha de ingreso</Label>
          <Input
            id="ee-ingreso"
            type="date"
            value={fechaIngreso}
            onChange={(e) => setFechaIngreso(e.target.value)}
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

/** Cómo se le paga al trabajador, tal cual se edita en el formulario. */
type DatosPago = { tipo_pago: TipoPago; salario: string; auxilio: string };

// Al pasar a salario fijo se propone el mínimo legal vigente + auxilio.
const PAGO_POR_DEFECTO: DatosPago = {
  tipo_pago: "comision",
  salario: String(SMMLV),
  auxilio: String(AUXILIO_TRANSPORTE),
};

/** Columnas de pago para la BD. Lanza si el salario no es válido. */
function validarPago(p: DatosPago) {
  if (p.tipo_pago === "comision") {
    return { tipo_pago: p.tipo_pago, salario_mensual: 0, auxilio_transporte: 0 };
  }
  const salario = Number(p.salario);
  const auxilio = Number(p.auxilio || 0);
  if (!Number.isFinite(salario) || salario <= 0)
    throw new Error("El salario mensual debe ser mayor que cero");
  if (!Number.isFinite(auxilio) || auxilio < 0)
    throw new Error("El auxilio de transporte no puede ser negativo");
  return { tipo_pago: p.tipo_pago, salario_mensual: salario, auxilio_transporte: auxilio };
}

/**
 * Selector de tipo de pago: comisión (% de lo que lava) o salario fijo, que se
 * paga por quincena en la nómina aparte y no gana comisión.
 */
function CamposPago({
  pago,
  onChange,
}: {
  pago: DatosPago;
  onChange: (p: DatosPago) => void;
}) {
  const quincena = pagoQuincena({
    salario_mensual: Number(pago.salario) || 0,
    auxilio_transporte: Number(pago.auxilio) || 0,
  });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={pago.tipo_pago === "salario"}
          onChange={(e) =>
            onChange({ ...pago, tipo_pago: e.target.checked ? "salario" : "comision" })
          }
        />
        Salario fijo (no gana comisión, se paga por quincena)
      </label>
      {pago.tipo_pago === "salario" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pago-salario">Salario mensual</Label>
            <Input
              id="pago-salario"
              type="number"
              min={0}
              value={pago.salario}
              onChange={(e) => onChange({ ...pago, salario: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pago-auxilio">Auxilio de transporte</Label>
            <Input
              id="pago-auxilio"
              type="number"
              min={0}
              value={pago.auxilio}
              onChange={(e) => onChange({ ...pago, auxilio: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Por quincena: <strong>{formatCOP(quincena)}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
