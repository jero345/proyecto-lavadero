import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCOP, formatFechaHora } from "@/lib/format";
import { LABEL_METODO_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EliminarMovimientoButton } from "@/components/EliminarMovimientoButton";
import type { CajaMovimiento, CajaTipo, TipoMovCaja } from "@/types/database.types";

type FiltroCaja = CajaTipo | "todas";
type FiltroTipo = TipoMovCaja | "todos";
type FiltroEstado = "todos" | "abiertos" | "cerrados";

const LABEL_CAJA: Record<CajaTipo, string> = {
  principal: "Principal",
  inventario: "Inventario",
};

export default function Movimientos() {
  const { isSuperAdmin } = useAuth();
  const [busqueda, setBusqueda] = useState("");
  const [caja, setCaja] = useState<FiltroCaja>("todas");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [estado, setEstado] = useState<FiltroEstado>("todos");

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
        <span className="text-sm text-muted-foreground">
          {filtrados.length} movimiento(s) · Neto {formatCOP(total)}
        </span>
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
                    {isSuperAdmin && <TableHead className="text-right">Acciones</TableHead>}
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
                      {isSuperAdmin && (
                        <TableCell className="text-right">
                          {m.cierre_id == null && m.orden_id == null ? (
                            <EliminarMovimientoButton movimiento={m} />
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
    </div>
  );
}
