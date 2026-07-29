// Etiquetas y metadatos de dominio (labels en español, colores de estado).
import {
  Bike,
  Bus,
  Car,
  CarFront,
  Caravan,
  Gauge,
  HardHat,
  Tractor,
  Truck,
  type LucideIcon,
} from "lucide-react";

import type { CierreCaja, EstadoOrden, MetodoPago } from "@/types/database.types";

/**
 * Total de ingresos de un cierre = lo cobrado por los tres métodos de pago.
 * No es una columna de la BD: se calcula para no migrar los cierres viejos.
 */
export function ingresosCierre(c: CierreCaja): number {
  return Number(c.total_efectivo) + Number(c.total_qr) + Number(c.total_transferencia);
}

// Los tipos de vehículo son un catálogo dinámico (tabla tipos_vehiculo), así que
// el icono/color no se pueden fijar por código: se deducen por palabras clave del
// código y del nombre. Así un tipo nuevo ("Buseta", "Motos de 200 a 500 C.C")
// recibe el icono de su familia sin tocar el código.
// Ojo con el orden: gana la primera familia que coincida, por eso "camioneta" va
// antes que "camion" y "buseta" antes que "bus".
type FamiliaTipo = { claves: string[]; Icon: LucideIcon; color: string };

const FAMILIAS_TIPO: FamiliaTipo[] = [
  { claves: ["casco"], Icon: HardHat, color: "bg-amber-100 text-amber-600" },
  {
    claves: ["bicicleta", "bici", "cicla", "bmx"],
    Icon: Bike,
    color: "bg-emerald-100 text-emerald-600",
  },
  {
    claves: ["moto", "cilindraje", "scooter"],
    Icon: Gauge,
    color: "bg-violet-100 text-violet-600",
  },
  {
    claves: ["camioneta", "suv", "pickup", "pick_up", "4x4"],
    Icon: CarFront,
    color: "bg-indigo-100 text-indigo-600",
  },
  {
    claves: ["buseta", "microbus", "bus", "van"],
    Icon: Bus,
    color: "bg-teal-100 text-teal-600",
  },
  {
    claves: ["camion", "volqueta", "furgon", "tracto", "mula", "turbo"],
    Icon: Truck,
    color: "bg-rose-100 text-rose-600",
  },
  { claves: ["tractor"], Icon: Tractor, color: "bg-lime-100 text-lime-600" },
  {
    claves: ["trailer", "remolque", "caravana"],
    Icon: Caravan,
    color: "bg-orange-100 text-orange-600",
  },
  {
    claves: ["auto", "carro", "sedan", "taxi", "hatchback"],
    Icon: Car,
    color: "bg-sky-100 text-sky-600",
  },
];

const FAMILIA_DEFECTO: FamiliaTipo = {
  claves: [],
  Icon: Car,
  color: "bg-slate-100 text-slate-600",
};

/** Normaliza para comparar: sin acentos, minúsculas y sin signos. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function familiaTipoVehiculo(codigo: string, nombre = ""): FamiliaTipo {
  const texto = `${normalizar(codigo)}_${normalizar(nombre)}`;
  return FAMILIAS_TIPO.find((f) => f.claves.some((c) => texto.includes(c))) ?? FAMILIA_DEFECTO;
}

/** Icono para un tipo de vehículo (Car por defecto si no se reconoce). */
export function iconoTipoVehiculo(codigo: string, nombre = ""): LucideIcon {
  return familiaTipoVehiculo(codigo, nombre).Icon;
}

/** Color del icono de un tipo de vehículo (mismo color para toda la familia). */
export function colorTipoVehiculo(codigo: string, nombre = ""): string {
  return familiaTipoVehiculo(codigo, nombre).color;
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
