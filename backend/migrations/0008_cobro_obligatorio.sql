-- ============================================================================
-- Todo en Uno · Car Wash Services — Migración 0008: Cobro obligatorio
-- Regla de negocio: una orden NO puede avanzar de estado (completarse ni
-- entregarse) mientras no esté cobrada (metodo_pago is null = "Sin cobrar").
-- El cobro se hace con cobrar_orden() o creando la orden con método de pago.
-- Idempotente (create or replace). Re-define avanzar_estado_orden de 0003.
-- ============================================================================

begin;

create or replace function public.avanzar_estado_orden(p_orden_id uuid)
returns public.ordenes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       public.ordenes;
  v_siguiente text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  if not (public.is_staff() or v_row.created_by = v_uid) then
    raise exception 'No autorizado';
  end if;

  -- Cobro obligatorio: el servicio debe estar pagado antes de avanzar.
  if v_row.metodo_pago is null then
    raise exception 'Debe cobrar la orden antes de completarla';
  end if;

  v_siguiente := case v_row.estado
    when 'en_proceso' then 'completado'
    when 'completado' then 'entregado'
    else null
  end;
  if v_siguiente is null then
    raise exception 'La orden ya está entregada';
  end if;

  update public.ordenes set estado = v_siguiente
  where id = p_orden_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.avanzar_estado_orden(uuid) to authenticated;

commit;
