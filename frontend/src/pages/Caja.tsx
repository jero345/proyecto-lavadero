import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatCOP, formatFechaHora } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { LABEL_METODO_PAGO } from "@/lib/dominio";
import { NuevoMovimientoDialog } from "@/components/NuevoMovimientoDialog";
import type { CajaMovimiento, CierreCaja } from "@/types/database.types";

export default function Caja() {
  const queryClient = useQueryClient();

  const { data: abiertos = [] } = useQuery({
    queryKey: ["caja", "abiertos", "principal"],
    queryFn: async (): Promise<CajaMovimiento[]> => {
      const { data, error } = await supabase
        .from("caja_movimientos")
        .select("*")
        .eq("caja", "principal")
        .is("cierre_id", null)
        // Los movimientos con fecha de otro día solo viven en el historial.
        .eq("fuera_de_caja", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: cierres = [] } = useQuery({
    queryKey: ["caja", "cierres", "principal"],
    queryFn: async (): Promise<CierreCaja[]> => {
      const { data, error } = await supabase
        .from("cierres_caja")
        .select("*")
        .eq("caja", "principal")
        .order("fecha_cierre", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const totales = useMemo(() => {
    const t = {
      efectivo: 0,
      qr: 0,
      transferencia: 0,
      ingresos: 0,
      egresos: 0,
      nomina: 0,
      general: 0,
    };
    for (const m of abiertos) {
      const monto = Number(m.monto);
      if (m.tipo === "egreso") {
        // Los egresos de nómina llevan el concepto "Nómina: …" (los genera
        // liquidar_nomina). Se muestran en su propio cajón, pero SÍ se restan.
        if ((m.concepto ?? "").startsWith("Nómina")) t.nomina += monto;
        else t.egresos += monto;
      } else {
        t.ingresos += monto;
        if (m.metodo_pago) t[m.metodo_pago] += monto;
      }
    }
    // Total real de la caja: todo lo que entró menos todo lo que salió.
    t.general = t.ingresos - t.egresos - t.nomina;
    return t;
  }, [abiertos]);

  const cerrarCaja = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cerrar_caja", { p_caja: "principal" });
      if (error) throw error;
      return data as CierreCaja;
    },
    onSuccess: (c) => {
      toast.success("Caja cerrada", {
        description: `Total general ${formatCOP(c.total_general)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo cerrar la caja", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      {/* Resumen de caja abierta */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ResumenCard titulo="Efectivo" valor={totales.efectivo} />
        <ResumenCard titulo="QR" valor={totales.qr} />
        <ResumenCard titulo="Transferencia" valor={totales.transferencia} />
        <ResumenCard titulo="Total ingresos" valor={totales.ingresos} positivo />
        <ResumenCard titulo="Egresos" valor={totales.egresos} negativo />
        <ResumenCard titulo="Nómina" valor={totales.nomina} negativo />
        <ResumenCard
          titulo="Total en caja"
          valor={totales.general}
          destacado
          className="sm:col-span-2"
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Total en caja = Efectivo + QR + Transferencia − Egresos − Nómina
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Movimientos sin cerrar</h2>
        <div className="flex gap-2">
          <NuevoMovimientoDialog caja="principal" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={abiertos.length === 0 || cerrarCaja.isPending}>
                {cerrarCaja.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                Cerrar caja
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Cerrar la caja?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se consolidarán {abiertos.length} movimiento(s) con un total de{" "}
                  <strong>{formatCOP(totales.general)}</strong>. Esta acción no se
                  puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => cerrarCaja.mutate()}>
                  Sí, cerrar caja
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {abiertos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay movimientos sin cerrar.
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
                {abiertos.map((m) => (
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
                    <TableCell>{m.metodo_pago ? LABEL_METODO_PAGO[m.metodo_pago] : "—"}</TableCell>
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
        </CardContent>
      </Card>

      {/* Historial de cierres */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimos cierres</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {cierres.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aún no hay cierres.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cierre</TableHead>
                  <TableHead className="text-right">Efectivo</TableHead>
                  <TableHead className="text-right">QR</TableHead>
                  <TableHead className="text-right">Transf.</TableHead>
                  <TableHead className="text-right">Egresos</TableHead>
                  <TableHead className="text-right">Nómina</TableHead>
                  <TableHead className="text-right">General</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cierres.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFechaHora(c.fecha_cierre)}
                    </TableCell>
                    <TableCell className="text-right">{formatCOP(c.total_efectivo)}</TableCell>
                    <TableCell className="text-right">{formatCOP(c.total_qr)}</TableCell>
                    <TableCell className="text-right">{formatCOP(c.total_transferencia)}</TableCell>
                    <TableCell className="text-right text-destructive">
                      {c.total_egresos > 0 ? "-" : ""}{formatCOP(c.total_egresos)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {c.total_nomina > 0 ? "-" : ""}{formatCOP(c.total_nomina)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCOP(c.total_general)}
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

function ResumenCard({
  titulo,
  valor,
  negativo,
  positivo,
  destacado,
  className,
}: {
  titulo: string;
  valor: number;
  /** Egresos/nómina: se pintan en rojo y con signo menos. */
  negativo?: boolean;
  /** Suma de ingresos: se pinta en verde. */
  positivo?: boolean;
  /** Total en caja: resaltado (rojo si quedó en negativo). */
  destacado?: boolean;
  className?: string;
}) {
  const color = negativo
    ? "text-destructive"
    : positivo
      ? "text-emerald-600"
      : destacado
        ? valor < 0
          ? "text-destructive"
          : "text-primary"
        : "";

  return (
    <Card className={`${destacado ? "border-primary" : ""} ${className ?? ""}`}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={`mt-1 text-xl font-bold ${color}`}>
          {negativo && valor > 0 ? "-" : ""}
          {formatCOP(valor)}
        </p>
      </CardContent>
    </Card>
  );
}
