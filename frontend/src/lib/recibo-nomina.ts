// Comprobante de nómina en tirilla 80mm: qué trabajó el empleado en el periodo
// liquidado y cuánto se le paga. Se imprime en la térmica o se guarda como PDF
// desde el mismo diálogo del navegador.

import { supabase } from "./supabase";
import { documentoTirilla, esc, imprimirHTML, numeroRecibo } from "./recibo";
import { formatCOP, formatFecha, formatFechaHora } from "./format";
import type { NominaLiquidacion } from "@/types/database.types";

/**
 * Trae el detalle del periodo (mismo criterio con que se liquidó) e imprime el
 * comprobante del trabajador. Lanza si falla la carga.
 */
export async function imprimirComprobanteNomina(
  liquidacion: NominaLiquidacion,
  nombreEmpleado: string,
) {
  const { data, error } = await supabase.rpc("detalle_nomina", {
    p_empleado_id: liquidacion.empleado_id,
    p_fecha_inicio: liquidacion.fecha_inicio,
    p_fecha_fin: liquidacion.fecha_fin,
  });
  if (error) throw error;

  const ordenes = data ?? [];

  // Dos líneas por orden: placa + fecha arriba, servicios + total abajo. La
  // placa va primero porque es lo que identifica el trabajo de un vistazo.
  const filas = ordenes
    .map(
      (o) => `<tr>
        <td class="bold">${esc(o.placa || "—")}</td>
        <td class="precio small">${esc(formatFechaHora(o.fecha))}</td>
      </tr>
      <tr>
        <td class="small pb">${esc(o.servicios || "—")}</td>
        <td class="precio pb">${formatCOP(o.total)}</td>
      </tr>`,
    )
    .join("");

  const cuerpoOrdenes =
    ordenes.length > 0
      ? `<table>${filas}</table>`
      : `<div class="small center">Sin órdenes registradas en el periodo.</div>`;

  // Un solo día liquidado se muestra como fecha suelta, no como rango.
  const periodo =
    liquidacion.fecha_inicio === liquidacion.fecha_fin
      ? formatFecha(liquidacion.fecha_inicio)
      : `${formatFecha(liquidacion.fecha_inicio)} – ${formatFecha(liquidacion.fecha_fin)}`;

  imprimirHTML(
    documentoTirilla(
      `Nomina ${numeroRecibo(liquidacion.id)}`,
      `
    <div class="sep"></div>
    <div class="center bold">COMPROBANTE DE NOMINA</div>
    <div class="center small">N° ${esc(numeroRecibo(liquidacion.id))}</div>

    <div class="sep"></div>
    <div class="row"><span>Trabajador</span><span class="r bold">${esc(nombreEmpleado)}</span></div>
    <div class="row"><span>Periodo</span><span class="r">${esc(periodo)}</span></div>
    <div class="row"><span>Emitido</span><span class="r">${esc(formatFechaHora(liquidacion.created_at))}</span></div>

    <div class="sep"></div>
    <div class="bold">TRABAJO DEL PERIODO</div>
    ${cuerpoOrdenes}

    <div class="sep"></div>
    <div class="row"><span>Ordenes atendidas</span><span class="r">${liquidacion.total_servicios}</span></div>
    <div class="row"><span>Total facturado</span><span class="r">${formatCOP(liquidacion.total_facturado)}</span></div>
    <div class="row"><span>Comision</span><span class="r">${liquidacion.porcentaje}%</span></div>

    <div class="sep"></div>
    <div class="row total bold"><span>A PAGAR</span><span class="r">${formatCOP(liquidacion.total_pagar)}</span></div>

    <div class="firma small">Recibí conforme · ${esc(nombreEmpleado)}</div>
`,
    ),
  );
}
