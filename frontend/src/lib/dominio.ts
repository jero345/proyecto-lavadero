// Etiquetas y metadatos de dominio (labels en español, colores de estado).
import type {
  EstadoOrden,
  MetodoPago,
  TipoVehiculo,
} from "@/types/database.types";

export const TIPOS_VEHICULO: { value: TipoVehiculo; label: string; emoji: string }[] = [
  { value: "moto", label: "Moto", emoji: "🏍️" },
  { value: "moto_alto", label: "Moto alto cil.", emoji: "🏍️" },
  { value: "auto", label: "Auto", emoji: "🚗" },
  { value: "camioneta", label: "Camioneta", emoji: "🚙" },
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
