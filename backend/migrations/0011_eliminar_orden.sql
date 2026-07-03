-- ============================================================================
-- Todo en Uno · Car Wash Services — Migración 0011: Eliminar orden (errores)
-- Permite borrar una orden equivocada de forma atómica y controlada.
--   - Staff: puede eliminar cualquiera.
--   - Creador o trabajador asignado: puede eliminar SOLO si NO está cobrada
--     (revertir un ingreso de caja queda reservado al admin).
--   - Nunca si la orden ya está incluida en un cierre de caja (rompería cuadre).
-- Quita el ingreso en caja (si estaba cobrada) y borra la orden; los ítems se
-- eliminan en cascada. Idempotente.
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
  v_row public.ordenes;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  -- Autorización.
  if not public.is_staff() then
    if not (
      v_row.created_by = v_uid
      or exists (
        select 1 from public.orden_items oi
        where oi.orden_id = p_orden_id and oi.empleado_id = v_uid
      )
    ) then
      raise exception 'No autorizado';
    end if;
    if v_row.metodo_pago is not null then
      raise exception 'Solo un administrador puede eliminar una orden ya cobrada';
    end if;
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
