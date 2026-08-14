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
  const porcentaje = Number(liquidacion.porcentaje);

  // El comprobante muestra lo que GANA el trabajador en cada orden (su %), no
  // lo que se le facturó al cliente.
  const comisiones = ordenes.map((o) => Math.round((Number(o.total) * porcentaje) / 100));

  // El "A pagar" se calculó sobre el total del periodo, así que redondear orden
  // por orden puede dar unos pesos de diferencia. La diferencia se carga a la
  // última línea para que las líneas sumen exactamente el total pagado.
  const sumaComisiones = comisiones.reduce((acc, c) => acc + c, 0);
  const ajuste = Number(liquidacion.total_pagar) - sumaComisiones;
  if (comisiones.length > 0 && ajuste !== 0) {
    comisiones[comisiones.length - 1] += ajuste;
  }

  // Dos líneas por orden: placa + fecha arriba, servicios + comisión abajo. La
  // placa va primero porque es lo que identifica el trabajo de un vistazo.
  const filas = ordenes
    .map(
      (o, i) => `<tr>
        <td class="bold">${esc(o.placa || "—")}</td>
        <td class="precio small">${esc(formatFechaHora(o.fecha))}</td>
      </tr>
      <tr>
        <td class="small pb">${esc(o.servicios || "—")}</td>
        <td class="precio pb">${formatCOP(comisiones[i])}</td>
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
    <div class="small">Valores = tu ${porcentaje}% de cada orden</div>
    ${cuerpoOrdenes}

    <div class="sep"></div>
    <div class="row"><span>Ordenes atendidas</span><span class="r">${liquidacion.total_servicios}</span></div>
    <div class="row"><span>Comision</span><span class="r">${liquidacion.porcentaje}%</span></div>

    <div class="sep"></div>
    <div class="row total bold"><span>A PAGAR</span><span class="r">${formatCOP(liquidacion.total_pagar)}</span></div>

    <div class="firma small">Recibí conforme · ${esc(nombreEmpleado)}</div>
`,
    ),
  );
}
