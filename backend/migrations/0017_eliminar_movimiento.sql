-- ============================================================================
-- CAR WASH SERVICES — Migración 0017: Eliminar movimiento de caja (super admin)
-- Permite al SUPER ADMIN borrar un movimiento de caja suelto (errores, ajustes,
-- nómina mal liquidada). Protecciones:
--   - Solo rol super_admin.
--   - No se puede borrar un movimiento ya incluido en un cierre de caja
--     (rompería el cuadre); primero habría que reabrir/anular el cierre.
--   - Si el movimiento pertenece a una orden (orden_id), se bloquea: esa orden
--     se corrige/elimina desde Órdenes (que ya limpia su ingreso en caja).
-- Idempotente.
-- ============================================================================

begin;

create or replace function public.eliminar_movimiento(p_mov_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mov public.caja_movimientos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and rol = 'super_admin'
  ) then
    raise exception 'No autorizado: se requiere super admin';
  end if;

  select * into v_mov from public.caja_movimientos where id = p_mov_id;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;

  if v_mov.cierre_id is not null then
    raise exception 'No se puede eliminar: el movimiento ya está en un cierre de caja';
  end if;

  if v_mov.orden_id is not null then
    raise exception 'Este movimiento pertenece a una orden; elimínala desde Órdenes';
  end if;

  delete from public.caja_movimientos where id = p_mov_id;
end;
$$;

grant execute on function public.eliminar_movimiento(uuid) to authenticated;

commit;
