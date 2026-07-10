// Etiquetas y metadatos de dominio (labels en español, colores de estado).
import { Bike, Car, Truck, Gauge, type LucideIcon } from "lucide-react";

import type { EstadoOrden, MetodoPago } from "@/types/database.types";

// Los tipos de vehículo ahora son un catálogo dinámico (tabla tipos_vehiculo).
// Estos helpers dan un icono/color de UI a cada tipo. Los 4 base tienen su
// icono; los tipos nuevos usan un icono y color por defecto (según su orden).
const ICONO_TIPO: Record<string, LucideIcon> = {
  moto: Bike,
  moto_alto: Gauge,
  auto: Car,
  camioneta: Truck,
};

/** Icono para un tipo de vehículo (Car por defecto para tipos nuevos). */
export function iconoTipoVehiculo(codigo: string): LucideIcon {
  return ICONO_TIPO[codigo] ?? Car;
}

const COLORES_TIPO = [
  "bg-sky-100 text-sky-600",
  "bg-indigo-100 text-indigo-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-rose-100 text-rose-600",
  "bg-violet-100 text-violet-600",
];

/** Color de fondo para el botón de un tipo de vehículo (ciclado por índice). */
export function colorTipoVehiculo(indice: number): string {
  return COLORES_TIPO[indice % COLORES_TIPO.length];
}

export const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "qr", label: "QR" },
  { value: "transferencia", label: "Transferencia" },
];

export const LABEL_METODO_PAGO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  qr: "QR",
  transferencia: "Transferencia",
};

export const ESTADOS_ORDEN: EstadoOrden[] = ["en_proceso", "completado", "entregado"];

export const LABEL_ESTADO: Record<EstadoOrden, string> = {
  en_proceso: "En proceso",
  completado: "Completado",
  entregado: "Entregado",
};

// Clases de Tailwind para el badge de cada estado.
export const CLASE_ESTADO: Record<EstadoOrden, string> = {
  en_proceso: "bg-amber-100 text-amber-800 border-amber-200",
  completado: "bg-blue-100 text-blue-800 border-blue-200",
  entregado: "bg-green-100 text-green-800 border-green-200",
};
