-- ============================================================================
-- CAR WASH SERVICES — Migración 0026: Eliminar órdenes SOLO super_admin
-- El negocio pide que borrar una orden deje de estar al alcance del admin: solo
-- el super_admin puede hacerlo. Revierte la apertura de la migración 0012
-- (donde cualquier usuario autenticado podía eliminar).
--   1) eliminar_orden(): exige rol super_admin.
--   2) RLS: el DELETE directo por REST sobre `ordenes` y `orden_items` también
--      queda solo para super_admin (antes bastaba con ser staff; si no, un
--      admin podía saltarse la función y borrar por la API).
-- Se conserva la protección de siempre: no se borra una orden ya incluida en un
-- cierre de caja (rompería el cuadre).
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) eliminar_orden: solo super_admin.
-- ---------------------------------------------------------------------------
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
  if not public.is_super_admin() then
    raise exception 'No autorizado: solo el super admin puede eliminar órdenes';
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

-- ---------------------------------------------------------------------------
-- 2) RLS: cerrar la puerta de atrás (DELETE por REST).
--    El resto de policies de ordenes/orden_items (select/insert/update) no
--    cambia: el admin sigue creando, cobrando y avanzando órdenes.
-- ---------------------------------------------------------------------------
drop policy if exists ordenes_delete on public.ordenes;
create policy ordenes_delete on public.ordenes for delete to authenticated
  using (public.is_super_admin());

drop policy if exists orden_items_delete on public.orden_items;
create policy orden_items_delete on public.orden_items for delete to authenticated
  using (public.is_super_admin());

commit;
