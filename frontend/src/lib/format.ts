// Utilidades de formato para Colombia (COP, fechas).

/**
 * Formatea un monto en pesos colombianos con el patrón $00.000
 * (punto como separador de miles, sin decimales).
 * Ej: 33000 → "$33.000"  ·  1290000 → "$1.290.000"
 */
export function formatCOP(monto: number | null | undefined): string {
  const valor = Number(monto ?? 0);
  const entero = Math.round(valor);
  // Inserta el punto de miles manualmente para evitar el espacio
  // que añade Intl con la moneda COP.
  const conMiles = Math.abs(entero)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${entero < 0 ? "-" : ""}$${conMiles}`;
}

/**
 * Parsea un string de moneda ("$33.000", "33.000", "33000") a número.
 * Útil para inputs de monto.
 */
export function parseCOP(texto: string): number {
  const limpio = texto.replace(/[^\d-]/g, "");
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : 0;
}

/** Formatea una fecha ISO a formato legible en español (Colombia). */
export function formatFecha(
  fecha: string | Date | null | undefined,
  opciones?: Intl.DateTimeFormatOptions,
): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...opciones,
  }).format(d);
}

/** Formatea fecha + hora (ej: para movimientos de caja). */
export function formatFechaHora(fecha: string | Date | null | undefined): string {
  return formatFecha(fecha, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
