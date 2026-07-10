-- ============================================================================
-- CAR WASH SERVICES — Migración 0020: Hora de salida (entrega)
-- Registra el momento en que la orden pasa a "entregado" (hora de salida del
-- vehículo), para mostrarlo en el recibo. avanzar_estado_orden sella
-- entregado_at = now() justo cuando el estado cambia a 'entregado'.
-- Idempotente.
-- ============================================================================

begin;

alter table public.ordenes
  add column if not exists entregado_at timestamptz;

comment on column public.ordenes.entregado_at is
  'Momento en que se entregó la orden (hora de salida). Lo sella avanzar_estado_orden.';

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

  if not (
    public.is_staff()
    or v_row.created_by = v_uid
    or exists (
      select 1 from public.orden_items oi
      where oi.orden_id = p_orden_id and oi.empleado_id = v_uid
    )
  ) then
    raise exception 'No autorizado';
  end if;

  -- Cobro obligatorio: no se puede completar/entregar sin cobrar.
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

  update public.ordenes
     set estado = v_siguiente,
         -- Sella la hora de salida al entregar (si aún no estaba puesta).
         entregado_at = case
           when v_siguiente = 'entregado' then coalesce(entregado_at, now())
           else entregado_at
         end
   where id = p_orden_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.avanzar_estado_orden(uuid) to authenticated;

commit;
