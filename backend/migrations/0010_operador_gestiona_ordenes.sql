-- ============================================================================
-- Todo en Uno · Car Wash Services — Migración 0010: El operario gestiona sus órdenes
-- Problema: un empleado (operario con login) veía órdenes en las que está
-- ASIGNADO como trabajador, pero al darles "Completado" o "Cobrar" el servidor
-- respondía "No autorizado", porque avanzar/cobrar solo lo permitía a staff o
-- al CREADOR de la orden.
--
-- Fix: además de staff y creador, permitir al TRABAJADOR ASIGNADO (empleado_id
-- de algún ítem = usuario actual). Coincide con lo que el empleado puede ver por
-- RLS, así que solo actúa sobre órdenes que ya le aparecen.
-- Se conservan las demás protecciones (cobro obligatorio para avanzar, total
-- calculado en el servidor, sin doble cobro). Idempotente.
-- ============================================================================

begin;

-- ----- avanzar_estado_orden (staff | creador | trabajador asignado) ---------
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

  update public.ordenes set estado = v_siguiente
  where id = p_orden_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.avanzar_estado_orden(uuid) to authenticated;

-- ----- cobrar_orden (staff | creador | trabajador asignado) -----------------
create or replace function public.cobrar_orden(
  p_orden_id    uuid,
  p_metodo_pago text
)
returns public.ordenes
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

  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is null or p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', coalesce(p_metodo_pago, '(vacío)');
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

  if v_row.metodo_pago is not null then
    raise exception 'La orden ya fue cobrada';
  end if;

  update public.ordenes set metodo_pago = p_metodo_pago
  where id = p_orden_id
  returning * into v_row;

  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, orden_id, created_by)
  values ('ingreso', 'Cobro orden ' || coalesce(v_row.placa,''), p_metodo_pago, v_row.total, p_orden_id, v_uid);

  return v_row;
end;
$$;

grant execute on function public.cobrar_orden(uuid, text) to authenticated;

commit;
