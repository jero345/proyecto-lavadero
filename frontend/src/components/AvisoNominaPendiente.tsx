import { Link } from "react-router-dom";
import { ArrowRight, HandCoins } from "lucide-react";

import { formatCOP } from "@/lib/format";
import { useNominaPendiente } from "@/hooks/queries";

/**
 * Aviso de "falta liquidar": trabajadores que atendieron órdenes hoy y todavía
 * no tienen su liquidación del día. Mismo formato que el recordatorio de
 * órdenes sin cobrar del Dashboard.
 *
 * `enlazar=false` en la pantalla de Nómina (ya estás ahí: no tiene sentido un
 * enlace a la misma página).
 */
export function AvisoNominaPendiente({ enlazar = true }: { enlazar?: boolean }) {
  const { data: pendientes = [] } = useNominaPendiente();

  if (pendientes.length === 0) return null;

  const totalTrabajado = pendientes.reduce((acc, p) => acc + Number(p.total), 0);
  const nombres = pendientes.map((p) => p.nombre).join(", ");

  const contenido = (
    <>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-700">
          <HandCoins className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            Falta liquidar {pendientes.length} trabajador
            {pendientes.length === 1 ? "" : "es"} de hoy
          </p>
          <p className="truncate text-sm text-amber-800" title={nombres}>
            {nombres} · {formatCOP(totalTrabajado)} trabajado
            {enlazar && " · toca para liquidar"}
          </p>
        </div>
      </div>
      {enlazar && <ArrowRight className="h-5 w-5 shrink-0" />}
    </>
  );

  const clases =
    "flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900";

  if (!enlazar) return <div className={clases}>{contenido}</div>;

  return (
    <Link to="/nomina" className={`${clases} transition-colors hover:bg-amber-100`}>
      {contenido}
    </Link>
  );
}
