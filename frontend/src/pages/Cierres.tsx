import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Pencil, RotateCcw } from "lucide-react";
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
import { aInputFechaHora, formatCOP, formatFechaHora } from "@/lib/format";
import { LABEL_METODO_PAGO, ingresosCierre } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { CajaMovimiento, CajaTipo, CierreCaja } from "@/types/database.types";

type FiltroCaja = CajaTipo | "todas";

const LABEL_CAJA: Record<CajaTipo, string> = {
  principal: "Principal",
  inventario: "Inventario",
};

/** Fecha local en formato YYYY-MM-DD, para comparar con los <input type="date">. */
function fechaLocal(iso: string): string {
  return aInputFechaHora(iso).slice(0, 10);
}

export default function Cierres() {
  const { isSuperAdmin } = useAuth();
  // Arranca en la caja PRINCIPAL: la caja de inventario es un flujo aparte y no
  // debe sumarse con la principal salvo que se pida ver "Todas las cajas".
  const [caja, setCaja] = useState<FiltroCaja>("principal");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [detalle, setDetalle] = useState<CierreCaja | null>(null);
  const [editandoTotal, setEditandoTotal] = useState<CierreCaja | null>(null);

  const { data: cierres = [], isLoading } = useQuery({
    queryKey: ["caja", "cierres", "historial"],
    queryFn: async (): Promise<CierreCaja[]> => {
      const { data, error } = await supabase
        .from("cierres_caja")
        .select("*")
        .order("fecha_cierre", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const filtrados = useMemo(
    () =>
      cierres.filter((c) => {
        if (caja !== "todas" && c.caja !== caja) return false;
        const dia = fechaLocal(c.fecha_cierre);
        if (desde && dia < desde) return false;
        if (hasta && dia > hasta) return false;
        return true;
      }),
    [cierres, caja, desde, hasta],
  );

  // Totales acumulados de los cierres que se están viendo.
  const totales = useMemo(() => {
    const t = { efectivo: 0, qr: 0, transferencia: 0, ingresos: 0, egresos: 0, nomina: 0, gastos: 0, general: 0 };
    for (const c of filtrados) {
      t.efectivo += Number(c.total_efectivo);
      t.qr += Number(c.total_qr);
      t.transferencia += Number(c.total_transferencia);
      t.ingresos += ingresosCierre(c);
      t.egresos += Number(c.total_egresos);
      t.nomina += Number(c.total_nomina);
      t.gastos += Number(c.total_gastos);
      t.general += Number(c.total_general);
    }
    return t;
  }, [filtrados]);

  const hayFiltros = caja !== "principal" || desde !== "" || hasta !== "";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Historial de cierres de caja</h2>
        <p className="text-xs text-muted-foreground">
          Todos los cierres realizados. Toca un cierre para ver los movimientos que
          quedaron consolidados en él.
        </p>
      </div>

      {/* Acumulado de los cierres visibles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <TotalTile titulo="Cierres" texto={String(filtrados.length)} />
        <TotalTile
          titulo="Total de los ingresos"
          texto={formatCOP(totales.ingresos)}
          className="text-emerald-600"
        />
        <TotalTile
          titulo="Egresos"
          texto={`${totales.egresos > 0 ? "-" : ""}${formatCOP(totales.egresos)}`}
          className="text-destructive"
        />
        <TotalTile
          titulo="Nómina"
          texto={`${totales.nomina > 0 ? "-" : ""}${formatCOP(totales.nomina)}`}
          className="text-destructive"
        />
        <TotalTile
          titulo="Gastos fijos"
          texto={`${totales.gastos > 0 ? "-" : ""}${formatCOP(totales.gastos)}`}
          className="text-destructive"
        />
        <TotalTile
          titulo="Total general"
          texto={formatCOP(totales.general)}
          className={totales.general < 0 ? "text-destructive" : "text-primary"}
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Caja</Label>
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
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-desde" className="text-xs text-muted-foreground">
            Desde
          </Label>
          <Input
            id="c-desde"
            type="date"
            className="w-40"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-hasta" className="text-xs text-muted-foreground">
            Hasta
          </Label>
          <Input
            id="c-hasta"
            type="date"
            className="w-40"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        {hayFiltros && (
          <Button
            variant="ghost"
            onClick={() => {
              setCaja("principal");
              setDesde("");
              setHasta("");
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Limpiar
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {cierres.length === 0
                ? "Aún no hay cierres de caja."
                : "Ningún cierre coincide con los filtros."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Cierre</TableHead>
                    <TableHead>Caja</TableHead>
                    <TableHead className="text-right">Efectivo</TableHead>
                    <TableHead className="text-right">QR</TableHead>
                    <TableHead className="text-right">Transf.</TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      Total de los ingresos
                    </TableHead>
                    <TableHead className="text-right">Egresos</TableHead>
                    <TableHead className="text-right">Nómina</TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      Gastos fijos
                    </TableHead>
                    <TableHead className="text-right">General</TableHead>
                    <TableHead className="text-right">Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatFechaHora(c.fecha_cierre)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{LABEL_CAJA[c.caja]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCOP(c.total_efectivo)}</TableCell>
                      <TableCell className="text-right">{formatCOP(c.total_qr)}</TableCell>
                      <TableCell className="text-right">
                        {formatCOP(c.total_transferencia)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">
                        {formatCOP(ingresosCierre(c))}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {c.total_egresos > 0 ? "-" : ""}
                        {formatCOP(c.total_egresos)}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {c.total_nomina > 0 ? "-" : ""}
                        {formatCOP(c.total_nomina)}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {c.total_gastos > 0 ? "-" : ""}
                        {formatCOP(c.total_gastos)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          Number(c.total_general) < 0 ? "text-destructive" : ""
                        }`}
                      >
                        <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                          {c.total_general_manual && (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 font-normal text-amber-700"
                              title={
                                c.total_general_editado_at
                                  ? `Total ajustado a mano el ${formatFechaHora(
                                      c.total_general_editado_at,
                                    )}`
                                  : "Total ajustado a mano"
                              }
                            >
                              Ajustado
                            </Badge>
                          )}
                          {formatCOP(c.total_general)}
                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5"
                              title="Editar el total general"
                              onClick={() => setEditandoTotal(c)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Ver movimientos del cierre"
                          onClick={() => setDetalle(c)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Fila de totales de todo lo filtrado */}
                  <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                    <TableCell colSpan={2}>Total ({filtrados.length})</TableCell>
                    <TableCell className="text-right">{formatCOP(totales.efectivo)}</TableCell>
                    <TableCell className="text-right">{formatCOP(totales.qr)}</TableCell>
                    <TableCell className="text-right">
                      {formatCOP(totales.transferencia)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600">
                      {formatCOP(totales.ingresos)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {totales.egresos > 0 ? "-" : ""}
                      {formatCOP(totales.egresos)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {totales.nomina > 0 ? "-" : ""}
                      {formatCOP(totales.nomina)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {totales.gastos > 0 ? "-" : ""}
                      {formatCOP(totales.gastos)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${totales.general < 0 ? "text-destructive" : ""}`}
                    >
                      {formatCOP(totales.general)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {detalle && (
        <DetalleCierreDialog
          key={detalle.id}
          cierre={detalle}
          onClose={() => setDetalle(null)}
        />
      )}

      {editandoTotal && (
        <EditarTotalDialog
          key={editandoTotal.id}
          cierre={editandoTotal}
          onClose={() => setEditandoTotal(null)}
        />
      )}
    </div>
  );
}

/**
 * Ajuste manual del total general de un cierre (solo super admin). El desglose
 * por método de pago no se toca: se corrige únicamente ese valor.
 */
function EditarTotalDialog({
  cierre,
  onClose,
}: {
  cierre: CierreCaja;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState(String(cierre.total_general));

  // El total que sale de los movimientos del cierre (por si quiere volver a él).
  const calculado =
    ingresosCierre(cierre) -
    Number(cierre.total_egresos) -
    Number(cierre.total_nomina) -
    Number(cierre.total_gastos);

  const guardar = useMutation({
    // total null = quitar el ajuste y volver al calculado.
    mutationFn: async (total: number | null) => {
      if (total !== null && !Number.isFinite(total)) throw new Error("Total inválido");
      const { error } = await supabase.rpc("editar_total_cierre", {
        p_cierre_id: cierre.id,
        p_total: total,
      });
      if (error) throw error;
    },
    onSuccess: (_d, total) => {
      toast.success(total === null ? "Total recalculado" : "Total actualizado");
      queryClient.invalidateQueries({ queryKey: ["caja"] });
      onClose();
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
          <DialogTitle>Total general del cierre</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Cierre del {formatFechaHora(cierre.fecha_cierre)} · caja{" "}
            {LABEL_CAJA[cierre.caja]}. Solo se cambia este total: el desglose por
            método de pago, egresos y nómina queda igual.
          </p>

          <div className="space-y-2">
            <Label htmlFor="ec-total">Total general</Label>
            <Input
              id="ec-total"
              type="number"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Calculado desde los movimientos: {formatCOP(calculado)}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {cierre.total_general_manual ? (
            <Button
              variant="outline"
              disabled={guardar.isPending}
              onClick={() => guardar.mutate(null)}
            >
              <RotateCcw className="h-4 w-4" />
              Volver al calculado
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(Number(valor))}
          >
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recuadro con un acumulado del listado filtrado. */
function TotalTile({
  titulo,
  texto,
  className,
}: {
  titulo: string;
  texto: string;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={`mt-0.5 text-lg font-bold ${className ?? ""}`}>{texto}</p>
      </CardContent>
    </Card>
  );
}

/** Movimientos consolidados en un cierre. */
function DetalleCierreDialog({
  cierre,
  onClose,
}: {
  cierre: CierreCaja;
  onClose: () => void;
}) {
  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ["caja", "cierres", cierre.id, "movimientos"],
    queryFn: async (): Promise<CajaMovimiento[]> => {
      const { data, error } = await supabase
        .from("caja_movimientos")
        .select("*")
        .eq("cierre_id", cierre.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cierre del {formatFechaHora(cierre.fecha_cierre)}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Dato titulo="Caja" valor={LABEL_CAJA[cierre.caja]} />
          <Dato
            titulo="Desde"
            valor={cierre.fecha_apertura ? formatFechaHora(cierre.fecha_apertura) : "—"}
          />
          <Dato
            titulo="Total de los ingresos"
            valor={formatCOP(ingresosCierre(cierre))}
            className="text-emerald-600"
          />
          <Dato
            titulo="Total general"
            valor={formatCOP(cierre.total_general)}
            className={Number(cierre.total_general) < 0 ? "text-destructive" : "text-primary"}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : movimientos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Este cierre no tiene movimientos asociados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movimientos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFechaHora(m.created_at)}
                    </TableCell>
                    <TableCell>{m.concepto || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={m.tipo === "ingreso" ? "secondary" : "destructive"}>
                        {m.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {m.metodo_pago ? LABEL_METODO_PAGO[m.metodo_pago] : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        m.tipo === "egreso" ? "text-destructive" : ""
                      }`}
                    >
                      {m.tipo === "egreso" ? "-" : ""}
                      {formatCOP(m.monto)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dato({
  titulo,
  valor,
  className,
}: {
  titulo: string;
  valor: string;
  className?: string;
}) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`font-semibold ${className ?? ""}`}>{valor}</p>
    </div>
  );
}
