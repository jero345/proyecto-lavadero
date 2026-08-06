import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Car,
  ChevronDown,
  Clock,
  DollarSign,
  ArrowRight,
  Loader2,
  MessageCircle,
  Phone,
  Printer,
  BellRing,
  StickyNote,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatCOP, formatFechaHora } from "@/lib/format";
import { linkLlamada, linkWhatsApp } from "@/lib/contacto";
import { supabase } from "@/lib/supabase";
import { imprimirReciboDeOrden } from "@/lib/recibo-orden";
import { CobrarOrdenDialog } from "@/components/CobrarOrdenDialog";
import { NuevoMovimientoDialog } from "@/components/NuevoMovimientoDialog";
import { EliminarOrdenButton } from "@/components/EliminarOrdenButton";
import { AsignarEmpleadoButton } from "@/components/AsignarEmpleadoButton";
import { CLASE_ESTADO, LABEL_ESTADO } from "@/lib/dominio";
import {
  useOrdenesSinCobrar,
  aplanarEmpleado,
  SELECT_ORDEN_CON_EMPLEADO,
  type OrdenConEmpleado,
} from "@/hooks/queries";
import { useRealtimeOrdenes } from "@/hooks/useRealtimeOrdenes";
import type { EstadoOrden, Orden } from "@/types/database.types";

const SIGUIENTE_ESTADO: Record<EstadoOrden, EstadoOrden | null> = {
  en_proceso: "completado",
  completado: "entregado",
  entregado: null,
};

function inicioDeHoyISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  useRealtimeOrdenes();
  const [cobrarDe, setCobrarDe] = useState<Orden | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<string | null>(null);

  // Imprime el recibo: trae los ítems (servicio + empleado) y lanza la impresión.
  async function imprimirRecibo(orden: Orden) {
    setImprimiendoId(orden.id);
    try {
      await imprimirReciboDeOrden(orden);
    } catch (e) {
      toast.error("No se pudo generar el recibo", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setImprimiendoId(null);
    }
  }

  // Órdenes activas (no entregadas) — "vehículos en proceso".
  const { data: activas = [], isLoading: cargandoActivas } = useQuery({
    queryKey: ["dashboard", "activas"],
    queryFn: async (): Promise<OrdenConEmpleado[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select(SELECT_ORDEN_CON_EMPLEADO)
        .neq("estado", "entregado")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(aplanarEmpleado);
    },
  });

  // Momento del último cierre de nómina. El tablero "Vehículos en proceso" solo
  // muestra órdenes creadas DESPUÉS de ese cierre: al liquidar nómina, el tablero
  // se limpia solo (las órdenes NO se borran; siguen en Órdenes y en la caja).
  const { data: ultimoCierreNomina = null } = useQuery({
    queryKey: ["dashboard", "ultimo-cierre-nomina"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("nomina_liquidaciones")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.created_at ?? null;
    },
  });

  // Órdenes visibles en el tablero. El cierre de nómina limpia el tablero, PERO
  // una orden SIN COBRAR nunca se oculta (si no, se perdería el cobro): solo se
  // quitan las que ya están cobradas y son previas al último cierre.
  const cierreMs = ultimoCierreNomina ? new Date(ultimoCierreNomina).getTime() : null;
  const activasVisibles = useMemo(
    () =>
      cierreMs == null
        ? activas
        : activas.filter(
            (o) =>
              o.metodo_pago == null || new Date(o.created_at).getTime() > cierreMs,
          ),
    [activas, cierreMs],
  );

  // Órdenes de hoy (para KPIs).
  const { data: hoy = [] } = useQuery({
    queryKey: ["dashboard", "hoy"],
    queryFn: async (): Promise<Orden[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select("*")
        .gte("created_at", inicioDeHoyISO());
      if (error) throw error;
      return data;
    },
  });

  // Órdenes ya entregadas pero sin cobrar (se salieron del flujo "en proceso").
  // Solo es relevante para staff (cobrar toca caja).
  const { data: sinCobrar = [] } = useQuery({
    queryKey: ["dashboard", "sin-cobrar"],
    queryFn: async (): Promise<OrdenConEmpleado[]> => {
      const { data, error } = await supabase
        .from("ordenes")
        .select(SELECT_ORDEN_CON_EMPLEADO)
        .eq("estado", "entregado")
        .is("metodo_pago", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(aplanarEmpleado);
    },
  });

  // Ingresos reales en caja hoy = solo órdenes ya cobradas (con método de pago).
  // Las agendadas (pendientes de cobro) no cuentan hasta que se cobren.
  const ingresosHoy = useMemo(
    () =>
      hoy
        .filter((o) => o.metodo_pago != null)
        .reduce((acc, o) => acc + Number(o.total), 0),
    [hoy],
  );

  // Recordatorio de órdenes sin cobrar (en cualquier estado).
  const { data: pendientesCobro = [] } = useOrdenesSinCobrar();
  const totalPendiente = useMemo(
    () => pendientesCobro.reduce((acc, o) => acc + Number(o.total), 0),
    [pendientesCobro],
  );

  // Aviso emergente al entrar, una vez por montaje, si hay pendientes de cobro.
  const yaAviso = useRef(false);
  useEffect(() => {
    if (yaAviso.current || pendientesCobro.length === 0) return;
    yaAviso.current = true;
    toast.warning(
      `Tienes ${pendientesCobro.length} orden${pendientesCobro.length === 1 ? "" : "es"} sin cobrar`,
      { description: `${formatCOP(totalPendiente)} pendiente de cobro` },
    );
  }, [pendientesCobro.length, totalPendiente]);

  const avanzarEstado = useMutation({
    mutationFn: async ({ id }: { id: string; estado: EstadoOrden }) => {
      // La función del servidor calcula el siguiente estado y solo toca esa columna.
      const { error } = await supabase.rpc("avanzar_estado_orden", { p_orden_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      {/* Recordatorio: órdenes sin cobrar */}
      {pendientesCobro.length > 0 && (
        <Link
          to="/ordenes"
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 transition-colors hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-700">
              <BellRing className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">
                {pendientesCobro.length} orden{pendientesCobro.length === 1 ? "" : "es"} sin cobrar
              </p>
              <p className="text-sm text-amber-800">
                {formatCOP(totalPendiente)} pendiente de cobro · toca para revisar
              </p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </Link>
      )}

      {/* Registro rápido de un gasto: también lo puede hacer el empleado
          (el servidor solo le permite egresos de la caja principal). */}
      <div className="flex justify-end">
        <NuevoMovimientoDialog caja="principal" soloEgreso triggerLabel="Registrar egreso" />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          titulo="Vehículos en proceso"
          valor={activasVisibles.length.toString()}
          icon={<Car className="h-5 w-5" />}
          color="bg-blue-100 text-blue-600"
        />
        <KpiCard
          titulo="Órdenes de hoy"
          valor={hoy.length.toString()}
          icon={<Clock className="h-5 w-5" />}
          color="bg-violet-100 text-violet-600"
        />
        <KpiCard
          titulo="Ingresos de hoy"
          valor={formatCOP(ingresosHoy)}
          icon={<DollarSign className="h-5 w-5" />}
          color="bg-emerald-100 text-emerald-600"
        />
      </div>

      {/* Vehículos en proceso (realtime) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vehículos en proceso</CardTitle>
          <Badge variant="secondary" className="gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            En vivo
          </Badge>
        </CardHeader>
        <CardContent>
          {cargandoActivas ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : activasVisibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay vehículos en proceso.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {activasVisibles.map((o) => (
                <div key={o.id} className="flex flex-col rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg font-bold tracking-wide">
                        {o.placa || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFechaHora(o.created_at)}
                      </p>
                      {o.cliente_nombre && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-medium">
                          <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {o.cliente_nombre}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-0.5 text-xs font-medium",
                          o.empleado_nombre
                            ? "text-foreground"
                            : "italic text-muted-foreground",
                        )}
                      >
                        {o.empleado_nombre || "Sin empleado asignado"}
                      </p>
                      {o.observaciones && (
                        <p
                          className="mt-1 flex gap-1 text-xs text-amber-700"
                          title={o.observaciones}
                        >
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{o.observaciones}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={CLASE_ESTADO[o.estado]} variant="outline">
                        {LABEL_ESTADO[o.estado]}
                      </Badge>
                      {o.metodo_pago == null ? (
                        <Badge
                          variant="outline"
                          className="border-rose-200 bg-rose-50 text-rose-700"
                        >
                          Sin cobrar
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-50 text-green-700"
                        >
                          Pagado
                        </Badge>
                      )}
                    </div>
                  </div>
                  {/* Contacto del cliente: fila propia, separada de las acciones
                      de la orden (antes se mezclaban y los botones se partían). */}
                  <ContactoCliente orden={o} />

                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    <span className="font-semibold">{formatCOP(o.total)}</span>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={imprimiendoId === o.id}
                        title="Imprimir recibo"
                        onClick={() => void imprimirRecibo(o)}
                      >
                        {imprimiendoId === o.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                        Recibo
                      </Button>
                      <AsignarEmpleadoButton
                        orden={o}
                        empleadoNombre={o.empleado_nombre}
                      />
                      {o.metodo_pago == null && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCobrarDe(o)}
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          Cobrar
                        </Button>
                      )}
                      {SIGUIENTE_ESTADO[o.estado] && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={avanzarEstado.isPending || o.metodo_pago == null}
                          title={
                            o.metodo_pago == null
                              ? "Cobra la orden antes de completarla"
                              : undefined
                          }
                          onClick={() =>
                            avanzarEstado.mutate({ id: o.id, estado: o.estado })
                          }
                        >
                          {avanzarEstado.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              {LABEL_ESTADO[SIGUIENTE_ESTADO[o.estado]!]}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </>
                          )}
                        </Button>
                      )}
                      <EliminarOrdenButton orden={o} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {sinCobrar.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entregadas sin cobrar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sinCobrar.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50/60 p-3"
                >
                  <div>
                    <p className="font-bold tracking-wide">{o.placa || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFechaHora(o.created_at)}
                      {o.cliente_nombre ? ` · ${o.cliente_nombre}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ContactoCliente orden={o} variante="iconos" />
                    <span className="font-semibold">{formatCOP(o.total)}</span>
                    <Button size="sm" variant="secondary" onClick={() => setCobrarDe(o)}>
                      <DollarSign className="h-3.5 w-3.5" />
                      Cobrar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {cobrarDe && (
        <CobrarOrdenDialog
          key={cobrarDe.id}
          orden={cobrarDe}
          onClose={() => setCobrarDe(null)}
        />
      )}
    </div>
  );
}

/** Nombre comercial que ve el cliente en los mensajes. */
const NEGOCIO = "TODO EN 1 AUTOMOTRIZ";

/**
 * Mensajes listos para enviar por WhatsApp, el más probable de primero. El aviso
 * de "ya está listo" está SIEMPRE disponible, aunque la orden no se haya
 * cobrado: primero se avisa, después se cobra. El texto se puede editar en
 * WhatsApp antes de enviarlo.
 */
function mensajesWhatsApp(o: OrdenConEmpleado) {
  const saludo = o.cliente_nombre ? `Hola ${o.cliente_nombre}` : "Hola";
  const vehiculo = o.placa ? ` (${o.placa})` : "";
  const cabecera = `${saludo}, le escribimos de ${NEGOCIO}.`;

  const listo = {
    clave: "listo",
    label: "Listo y pendiente de entrega",
    texto: `${cabecera} Su vehículo${vehiculo} ya está listo. Puede pasar a recogerlo. Gracias.`,
  };
  const proceso = {
    clave: "proceso",
    label: "Va en proceso",
    texto: `${cabecera} Su vehículo${vehiculo} está en proceso de lavado, le avisamos apenas esté listo.`,
  };
  const entregado = {
    clave: "entregado",
    label: "Entregado",
    texto: `Para ${NEGOCIO} es muy importante atender bien a nuestros clientes y brindar el mejor servicio posible. ¡Vuelve pronto!`,
  };

  return o.estado === "entregado" ? [entregado, listo] : [listo, proceso, entregado];
}

/**
 * Llamar o escribir por WhatsApp al cliente de la orden. En las tarjetas van
 * como fila con etiqueta (`variante="fila"`); en listas apretadas, como iconos.
 */
function ContactoCliente({
  orden,
  variante = "fila",
}: {
  orden: OrdenConEmpleado;
  variante?: "fila" | "iconos";
}) {
  const [pidiendoTelefono, setPidiendoTelefono] = useState(false);
  const tel = linkLlamada(orden.cliente_telefono);
  const hayWhatsApp = linkWhatsApp(orden.cliente_telefono) != null;
  const quien = orden.cliente_nombre ?? "el cliente";

  // Sin teléfono no hay a quién escribirle: si la orden tiene cliente, se puede
  // guardar el número aquí mismo; si no tiene, se explica por qué no hay botones.
  if (!tel && !hayWhatsApp) {
    if (!orden.cliente_id) {
      return variante === "fila" ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          Orden sin cliente: no hay a quién escribirle.
        </p>
      ) : null;
    }
    return (
      <>
        <Button
          size="sm"
          variant={variante === "fila" ? "outline" : "ghost"}
          className={variante === "fila" ? "mt-3 w-full" : undefined}
          title={`Guardar el teléfono de ${quien}`}
          onClick={() => setPidiendoTelefono(true)}
        >
          <Phone className="h-3.5 w-3.5" />
          {variante === "fila" ? "Agregar teléfono" : ""}
        </Button>
        {pidiendoTelefono && (
          <AgregarTelefonoDialog
            clienteId={orden.cliente_id}
            nombre={quien}
            onClose={() => setPidiendoTelefono(false)}
          />
        )}
      </>
    );
  }

  // El menú deja elegir qué avisar: "ya está listo" está siempre, aunque la
  // orden todavía no se haya cobrado.
  const menuWhatsApp = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Escribir a {quien}
        </DropdownMenuLabel>
        {mensajesWhatsApp(orden).map((m) => (
          <DropdownMenuItem key={m.clave} asChild>
            <a
              href={linkWhatsApp(orden.cliente_telefono, m.texto) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.texto}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variante === "iconos") {
    return (
      <>
        {tel && (
          <Button asChild size="sm" variant="ghost" title={`Llamar a ${quien}`}>
            <a href={tel}>
              <Phone className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {hayWhatsApp &&
          menuWhatsApp(
            <Button
              size="sm"
              variant="ghost"
              className="text-[#128C7E] hover:bg-emerald-50 hover:text-[#128C7E]"
              title={`Escribir a ${quien} por WhatsApp`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </Button>,
          )}
      </>
    );
  }

  return (
    <div className="mt-3 flex gap-2">
      {tel && (
        <Button asChild size="sm" variant="outline" className="flex-1">
          <a href={tel} title={`Llamar a ${quien}`}>
            <Phone className="h-3.5 w-3.5" />
            Llamar
          </a>
        </Button>
      )}
      {hayWhatsApp &&
        menuWhatsApp(
          <Button
            size="sm"
            className="flex-1 bg-[#25D366] text-white hover:bg-[#1DA851]"
            title={`Escribir a ${quien} por WhatsApp`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
          </Button>,
        )}
    </div>
  );
}

/** Guarda el teléfono del cliente de la orden para poder escribirle. */
function AgregarTelefonoDialog({
  clienteId,
  nombre,
  onClose,
}: {
  clienteId: string;
  nombre: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [telefono, setTelefono] = useState("");

  const guardar = useMutation({
    mutationFn: async () => {
      const limpio = telefono.trim();
      if (limpio.replace(/\D/g, "").length < 7) throw new Error("Teléfono incompleto");
      const { error } = await supabase
        .from("clientes")
        .update({ telefono: limpio })
        .eq("id", clienteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Teléfono guardado", { description: `Ya puedes escribirle a ${nombre}` });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes"] });
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo guardar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Teléfono de {nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="tel-cliente">Celular</Label>
          <Input
            id="tel-cliente"
            inputMode="tel"
            placeholder="300 000 0000"
            value={telefono}
            autoFocus
            onChange={(e) => setTelefono(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardar.mutate()}
          />
          <p className="text-xs text-muted-foreground">
            Queda guardado en la ficha del cliente para las próximas visitas.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({
  titulo,
  valor,
  icon,
  color = "bg-primary/10 text-primary",
}: {
  titulo: string;
  valor: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-2xl font-bold">{valor}</p>
        </div>
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${color}`}
        >
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}
