// Enlaces de contacto con el cliente (llamada y WhatsApp).

const INDICATIVO_CO = "57";

/** Deja solo los dígitos de un teléfono ("300 123 4567" -> "3001234567"). */
function soloDigitos(telefono: string): string {
  return telefono.replace(/\D/g, "");
}

/**
 * Número en formato internacional para wa.me (sin "+"). Si viene un celular
 * colombiano de 10 dígitos se le antepone el 57; si ya trae indicativo (o es un
 * número de otro país) se deja como está.
 */
export function numeroInternacional(telefono: string | null | undefined): string | null {
  const d = soloDigitos(telefono ?? "");
  if (d.length < 7) return null; // teléfono incompleto: no sirve para contactar
  if (d.length === 10) return INDICATIVO_CO + d;
  return d;
}

/** href para llamar (tel:). null si el teléfono no sirve. */
export function linkLlamada(telefono: string | null | undefined): string | null {
  const d = soloDigitos(telefono ?? "");
  return d.length >= 7 ? `tel:+${numeroInternacional(telefono)}` : null;
}

/** href para abrir el chat de WhatsApp con un mensaje ya escrito. */
export function linkWhatsApp(
  telefono: string | null | undefined,
  mensaje?: string,
): string | null {
  const numero = numeroInternacional(telefono);
  if (!numero) return null;
  const texto = mensaje ? `?text=${encodeURIComponent(mensaje)}` : "";
  return `https://wa.me/${numero}${texto}`;
}
