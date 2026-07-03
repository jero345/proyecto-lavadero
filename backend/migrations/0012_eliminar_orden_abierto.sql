-- ============================================================================
-- Todo en Uno · Car Wash Services — Migración 0012: Eliminar orden abierto
-- A pedido del negocio: CUALQUIER usuario autenticado puede eliminar cualquier
-- orden (incluidas las ya cobradas), para corregir errores sin depender del
-- admin. Reemplaza la versión restringida de 0011.
-- Única protección que se conserva: no borrar una orden ya incluida en un
-- cierre de caja (rompería el cuadre). Idempotente.
-- ============================================================================

begin;

create or replace function public.eliminar_orden(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (select 1 from public.ordenes where id = p_orden_id) then
    raise exception 'Orden no encontrada';
  end if;

  -- No romper un cierre de caja ya realizado.
  if exists (
    select 1 from public.caja_movimientos
    where orden_id = p_orden_id and cierre_id is not null
  ) then
    raise exception 'No se puede eliminar: la orden ya está incluida en un cierre de caja';
  end if;

  -- Quita el ingreso en caja (si estaba cobrada) y borra la orden.
  -- Los orden_items se eliminan en cascada (FK on delete cascade).
  delete from public.caja_movimientos where orden_id = p_orden_id;
  delete from public.ordenes where id = p_orden_id;
end;
$$;

grant execute on function public.eliminar_orden(uuid) to authenticated;

commit;
