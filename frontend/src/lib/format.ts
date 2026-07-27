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
  let d: Date;
  if (typeof fecha === "string") {
    // Un string "solo fecha" (YYYY-MM-DD, sin hora) lo interpreta JS como UTC
    // medianoche; en Colombia (UTC-5) eso retrocede al día anterior. Lo parseamos
    // como fecha LOCAL para que muestre el día correcto (ej. nómina).
    const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
    if (soloFecha) {
      const [y, m, day] = fecha.split("-").map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(fecha);
    }
  } else {
    d = fecha;
  }
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

/**
 * Convierte una fecha a "YYYY-MM-DDTHH:mm" (hora local), que es el formato que
 * exige <input type="datetime-local">.
 */
export function aInputFechaHora(fecha: string | Date = new Date()): string {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Pasa el valor de un <input type="datetime-local"> a ISO (UTC) para la BD. */
export function desdeInputFechaHora(valor: string): string {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
  return d.toISOString();
}

/** true si la fecha cae en el día de hoy (hora local del equipo). */
export function esHoy(fecha: string | Date): boolean {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return false;
  const hoy = new Date();
  return (
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate()
  );
}
