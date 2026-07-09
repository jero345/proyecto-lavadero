-- ============================================================================
-- CAR WASH SERVICES — Migración 0019: Editar/eliminar movimientos (staff)
-- 1) eliminar_movimiento: pasa de "solo super_admin" a "staff" (admin o
--    super_admin). Mantiene las protecciones: no borrar cerrados ni atados a
--    una orden.
-- 2) editar_movimiento (nuevo): staff puede corregir tipo/concepto/método/monto
--    de un movimiento suelto (no cerrado ni atado a una orden).
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) eliminar_movimiento: ahora para cualquier staff (admin o super_admin).
-- ---------------------------------------------------------------------------
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
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
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

-- ---------------------------------------------------------------------------
-- 2) editar_movimiento: staff corrige un movimiento suelto.
-- ---------------------------------------------------------------------------
create or replace function public.editar_movimiento(
  p_mov_id      uuid,
  p_tipo        text,
  p_concepto    text,
  p_metodo_pago text,
  p_monto       numeric
)
returns public.caja_movimientos
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
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
  end if;

  if p_tipo not in ('ingreso','egreso') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;
  if p_monto is null or p_monto < 0 then
    raise exception 'Monto inválido';
  end if;

  select * into v_mov from public.caja_movimientos where id = p_mov_id;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;
  if v_mov.cierre_id is not null then
    raise exception 'No se puede editar: el movimiento ya está en un cierre de caja';
  end if;
  if v_mov.orden_id is not null then
    raise exception 'Este movimiento pertenece a una orden; corrígela desde Órdenes';
  end if;

  update public.caja_movimientos
     set tipo        = p_tipo,
         concepto    = nullif(btrim(p_concepto), ''),
         metodo_pago = p_metodo_pago,
         monto       = p_monto
   where id = p_mov_id
  returning * into v_mov;

  return v_mov;
end;
$$;

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric) to authenticated;

commit;
