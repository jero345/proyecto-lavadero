import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Search } from "lucide-react";
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
import { formatCOP, formatFechaHora } from "@/lib/format";
import { LABEL_METODO_PAGO, METODOS_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EliminarMovimientoButton } from "@/components/EliminarMovimientoButton";
import type {
  CajaMovimiento,
  CajaTipo,
  MetodoPago,
  TipoMovCaja,
} from "@/types/database.types";

type FiltroCaja = CajaTipo | "todas";
type FiltroTipo = TipoMovCaja | "todos";
type FiltroEstado = "todos" | "abiertos" | "cerrados";

const LABEL_CAJA: Record<CajaTipo, string> = {
  principal: "Principal",
  inventario: "Inventario",
};

export default function Movimientos() {
  const { isStaff } = useAuth();
  const [busqueda, setBusqueda] = useState("");
  const [caja, setCaja] = useState<FiltroCaja>("todas");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [estado, setEstado] = useState<FiltroEstado>("todos");
  const [editando, setEditando] = useState<CajaMovimiento | null>(null);

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ["caja", "movimientos", "todos"],
    queryFn: async (): Promise<CajaMovimiento[]> => {
      const { data, error } = await supabase
        .from("caja_movimientos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return movimientos.filter((m) => {
      if (caja !== "todas" && m.caja !== caja) return false;
      if (tipo !== "todos" && m.tipo !== tipo) return false;
      if (estado === "abiertos" && m.cierre_id != null) return false;
      if (estado === "cerrados" && m.cierre_id == null) return false;
      if (q && !(m.concepto ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [movimientos, busqueda, caja, tipo, estado]);

  const total = useMemo(
    () =>
      filtrados.reduce(
        (acc, m) => acc + (m.tipo === "egreso" ? -Number(m.monto) : Number(m.monto)),
        0,
      ),
    [filtrados],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Movimientos</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {filtrados.length} movimiento(s) · Total (ingresos − egresos):
          </span>
          <span
            className={`text-base font-bold ${
              total < 0 ? "text-destructive" : "text-emerald-600"
            }`}
          >
            {formatCOP(total)}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por concepto…"
            className="pl-8"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={caja} onValueChange={(v) => setCaja(v as FiltroCaja)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las cajas</SelectItem>
            <SelectItem value="principal">Principal</SelectItem>
            <SelectItem value="inventario">Inventario</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as FiltroTipo)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Ingresos y egresos</SelectItem>
            <SelectItem value="ingreso">Solo ingresos</SelectItem>
            <SelectItem value="egreso">Solo egresos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={estado} onValueChange={(v) => setEstado(v as FiltroEstado)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="abiertos">Sin cerrar</SelectItem>
            <SelectItem value="cerrados">Cerrados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay movimientos que coincidan.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Caja</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    {isStaff && <TableHead className="text-right">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatFechaHora(m.created_at)}
                      </TableCell>
                      <TableCell>{m.concepto || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{LABEL_CAJA[m.caja]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.tipo === "ingreso" ? "secondary" : "destructive"}>
                          {m.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {m.metodo_pago ? LABEL_METODO_PAGO[m.metodo_pago] : "—"}
                      </TableCell>
                      <TableCell>
                        {m.cierre_id == null ? (
                          <span className="text-xs text-muted-foreground">Sin cerrar</span>
                        ) : (
                          <span className="text-xs text-emerald-600">Cerrado</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          m.tipo === "egreso" ? "text-destructive" : ""
                        }`}
                      >
                        {m.tipo === "egreso" ? "-" : ""}
                        {formatCOP(m.monto)}
                      </TableCell>
                      {isStaff && (
                        <TableCell className="text-right">
                          {m.cierre_id == null && m.orden_id == null ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Editar movimiento"
                                onClick={() => setEditando(m)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <EliminarMovimientoButton movimiento={m} />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editando && (
        <EditarMovimientoDialog
          key={editando.id}
          movimiento={editando}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

/** Diálogo para editar un movimiento de caja suelto (staff). */
function EditarMovimientoDialog({
  movimiento,
  onClose,
}: {
  movimiento: CajaMovimiento;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoMovCaja>(movimiento.tipo);
  const [concepto, setConcepto] = useState(movimiento.concepto ?? "");
  const [metodo, setMetodo] = useState<MetodoPago>(movimiento.metodo_pago ?? "efectivo");
  const [monto, setMonto] = useState(String(movimiento.monto));

  const guardar = useMutation({
    mutationFn: async () => {
      const valor = Number(monto);
      if (!Number.isFinite(valor) || valor < 0) throw new Error("Monto inválido");
      const { error } = await supabase.rpc("editar_movimiento", {
        p_mov_id: movimiento.id,
        p_tipo: tipo,
        p_concepto: concepto.trim() || null,
        p_metodo_pago: metodo,
        p_monto: valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimiento actualizado");
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar movimiento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMovCaja)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ingreso">Ingreso</SelectItem>
                <SelectItem value="egreso">Egreso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="em-concepto">Concepto</Label>
            <Input
              id="em-concepto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: compra de insumos"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Método</Label>
              <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label htmlFor="em-monto">Monto</Label>
              <Input
                id="em-monto"
                type="number"
                min={0}
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
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
