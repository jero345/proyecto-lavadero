import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCOP, formatFecha } from "@/lib/format";
import { METODOS_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import { useEmpleados } from "@/hooks/queries";
import type { MetodoPago, NominaLiquidacion } from "@/types/database.types";

/**
 * Fecha local en formato YYYY-MM-DD. NO usar toISOString(): convierte a UTC y en
 * Colombia (UTC-5) devuelve el día siguiente en la tarde/noche.
 */
function fechaLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function primerDiaDelMes() {
  const d = new Date();
  return fechaLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function hoyISO() {
  return fechaLocalISO(new Date());
}

export default function Nomina() {
  const queryClient = useQueryClient();
  const { data: empleados = [] } = useEmpleados();

  const [empleadoId, setEmpleadoId] = useState("");
  const [inicio, setInicio] = useState(primerDiaDelMes());
  const [fin, setFin] = useState(hoyISO());
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empleados) m.set(e.id, e.nombre);
    return m;
  }, [empleados]);

  const { data: liquidaciones = [] } = useQuery({
    queryKey: ["nomina", "liquidaciones"],
    queryFn: async (): Promise<NominaLiquidacion[]> => {
      const { data, error } = await supabase
        .from("nomina_liquidaciones")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const liquidar = useMutation({
    mutationFn: async () => {
      if (!empleadoId) throw new Error("Selecciona un empleado");
      const { data, error } = await supabase.rpc("liquidar_nomina", {
        p_empleado_id: empleadoId,
        p_fecha_inicio: inicio,
        p_fecha_fin: fin,
        p_metodo_pago: metodo,
      });
      if (error) throw error;
      return data as NominaLiquidacion;
    },
    onSuccess: (l) => {
      toast.success("Liquidación generada", {
        description:
          l.total_pagar > 0
            ? `A pagar ${formatCOP(l.total_pagar)} · egreso registrado en caja`
            : `${l.total_servicios} servicios · sin monto a pagar`,
      });
      // La liquidación mete un egreso en la caja principal.
      queryClient.invalidateQueries({ queryKey: ["nomina"] });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo liquidar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liquidar nómina</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-2">
              <Label>Empleado</Label>
              <Select value={empleadoId} onValueChange={setEmpleadoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {empleados.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre} · {e.porcentaje_comision}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inicio">Desde</Label>
              <Input
                id="inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fin">Hasta</Label>
              <Input
                id="fin"
                type="date"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pago con</Label>
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
            <Button onClick={() => liquidar.mutate()} disabled={liquidar.isPending}>
              {liquidar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              Liquidar
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Al liquidar, el monto a pagar se registra como <strong>egreso</strong> en la
            caja principal con el método elegido.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liquidaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {liquidaciones.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aún no hay liquidaciones.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead className="text-right">Servicios</TableHead>
                  <TableHead className="text-right">Facturado</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liquidaciones.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {nombrePorId.get(l.empleado_id) ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFecha(l.fecha_inicio)} – {formatFecha(l.fecha_fin)}
                    </TableCell>
                    <TableCell className="text-right">{l.total_servicios}</TableCell>
                    <TableCell className="text-right">{formatCOP(l.total_facturado)}</TableCell>
                    <TableCell className="text-right">{l.porcentaje}%</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatCOP(l.total_pagar)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
