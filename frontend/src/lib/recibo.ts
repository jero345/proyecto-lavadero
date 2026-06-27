// Genera un recibo de venta en formato tirilla (80mm) y lo manda a imprimir.
// El navegador abre su diálogo de impresión: desde ahí se imprime en la
// impresora térmica O se elige "Guardar como PDF". Sin librerías externas.

import { formatCOP, formatFechaHora } from "./format";
import { LABEL_METODO_PAGO } from "./dominio";
import { NEGOCIO } from "./negocio";
import type { MetodoPago, Orden } from "@/types/database.types";

export interface ReciboItem {
  nombre: string;
  precio: number;
}

/** Escapa texto para insertarlo de forma segura en el HTML del recibo. */
function esc(valor: string | null | undefined): string {
  return String(valor ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Número corto y estable de recibo, derivado del id de la orden. */
export function numeroRecibo(orden: Orden): string {
  return orden.id.replace(/-/g, "").slice(-6).toUpperCase();
}

/** Arma el documento HTML completo del recibo (tirilla 80mm). */
function construirHTML(opts: {
  orden: Orden;
  items: ReciboItem[];
  atendio?: string | null;
}): string {
  const { orden, items, atendio } = opts;
  const metodo: MetodoPago | null = orden.metodo_pago;

  const filas = items
    .map(
      (it) =>
        `<tr><td>${esc(it.nombre)}</td><td class="precio">${formatCOP(it.precio)}</td></tr>`,
    )
    .join("");

  const lineaPago = metodo
    ? `<div class="row"><span>Pago: ${esc(LABEL_METODO_PAGO[metodo])}</span><span class="r">${formatCOP(orden.total)}</span></div>`
    : `<div class="row bold"><span>** PENDIENTE DE PAGO **</span><span class="r"></span></div>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Recibo ${esc(numeroRecibo(orden))}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Courier New", ui-monospace, monospace; color: #000; }
  .recibo { width: 80mm; padding: 4mm 5mm; font-size: 12px; line-height: 1.35; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 16px; letter-spacing: 1px; }
  .small { font-size: 11px; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row .r { text-align: right; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; }
  td { font-size: 12px; vertical-align: top; padding: 1px 0; }
  td.precio { text-align: right; white-space: nowrap; padding-left: 8px; }
  .total { font-size: 14px; }
</style></head>
<body>
  <div class="recibo">
    <div class="center bold big">${esc(NEGOCIO.nombre)}</div>
    <div class="center">${esc(NEGOCIO.eslogan)}</div>
    <div class="center small">NIT ${esc(NEGOCIO.nit)}</div>
    <div class="center small">${esc(NEGOCIO.direccion)}</div>
    <div class="center small">Tel ${esc(NEGOCIO.telefono)}</div>

    <div class="sep"></div>
    <div class="center bold">RECIBO DE VENTA</div>
    <div class="center small">N° ${esc(numeroRecibo(orden))}</div>
    <div class="small">${esc(formatFechaHora(orden.created_at))}</div>
    <div class="small">Placa: ${esc(orden.placa || "—")}</div>
    ${atendio ? `<div class="small">Atendió: ${esc(atendio)}</div>` : ""}

    <div class="sep"></div>
    <table>${filas}</table>

    <div class="sep"></div>
    <div class="row total bold"><span>TOTAL</span><span class="r">${formatCOP(orden.total)}</span></div>
    ${lineaPago}

    <div class="sep"></div>
    <div class="center small">${esc(NEGOCIO.pie)}</div>
    <div class="center small">${esc(NEGOCIO.nombre)} · ${esc(NEGOCIO.eslogan)}</div>
  </div>
</body></html>`;
}

/**
 * Imprime un HTML usando un iframe oculto (no abre ventanas emergentes ni
 * navega fuera de la app). Tras imprimir, limpia el iframe.
 */
function imprimirHTML(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow!;
  let limpiado = false;
  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    iframe.remove();
  };

  const lanzar = () => {
    win.focus();
    win.onafterprint = limpiar;
    win.print();
    // Respaldo por si onafterprint no dispara (algunos navegadores).
    setTimeout(limpiar, 60_000);
  };

  if (doc.readyState === "complete") {
    setTimeout(lanzar, 50);
  } else {
    win.onload = () => setTimeout(lanzar, 50);
  }
}

/** Genera e imprime el recibo de una orden. */
export function imprimirReciboOrden(opts: {
  orden: Orden;
  items: ReciboItem[];
  atendio?: string | null;
}) {
  imprimirHTML(construirHTML(opts));
}
