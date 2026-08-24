import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { linkLlamada, linkWhatsApp } from "@/lib/contacto";
import { supabase } from "@/lib/supabase";
import type { OrdenConEmpleado } from "@/hooks/queries";

// Contacto del cliente de una orden (llamar / WhatsApp con mensajes listos).
// Vive aquí y no en una página porque lo usan el Dashboard (tarjetas) y
// Órdenes (tabla).

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
export function ContactoCliente({
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
