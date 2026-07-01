// Etiquetas y metadatos de dominio (labels en español, colores de estado).
import { Bike, Car, Truck, Gauge, type LucideIcon } from "lucide-react";

import type {
  EstadoOrden,
  MetodoPago,
  TipoVehiculo,
} from "@/types/database.types";

export const TIPOS_VEHICULO: {
  value: TipoVehiculo;
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { value: "moto", label: "Moto", icon: Bike, color: "bg-sky-100 text-sky-600" },
  { value: "moto_alto", label: "Moto alto cil.", icon: Gauge, color: "bg-indigo-100 text-indigo-600" },
  { value: "auto", label: "Auto", icon: Car, color: "bg-emerald-100 text-emerald-600" },
  { value: "camioneta", label: "Camioneta", icon: Truck, color: "bg-amber-100 text-amber-600" },
];

export const LABEL_TIPO_VEHICULO: Record<TipoVehiculo, string> = {
  moto: "Moto",
  moto_alto: "Moto alto cilindraje",
  auto: "Auto",
  camioneta: "Camioneta",
};

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
