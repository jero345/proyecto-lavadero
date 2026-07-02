-- ============================================================================
-- CAR WASH SERVICES — Migración 0012: Total editable para el operador
-- Antes solo el staff podía ajustar el "Total a cobrar" en el POS (override).
-- Ahora CUALQUIER usuario con sesión (incluido el empleado) puede hacerlo.
-- Los ítems siguen guardando el precio del catálogo (la comisión no cambia).
-- Idempotente (misma firma que 0010, solo cambia la condición del override).
-- ============================================================================

begin;

create or replace function public.crear_orden(
  p_servicio_ids   uuid[],
  p_empleado_id    uuid,
  p_metodo_pago    text,
  p_placa          text,
  p_cliente_id     uuid default null,
  p_vehiculo_id    uuid default null,
  p_foto_url       text default null,
  p_observaciones  text default null,
  p_total_override numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_comision  numeric;
  v_total     numeric := 0;
  v_orden_id  uuid;
  v_count     int;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_servicio_ids is null or array_length(p_servicio_ids, 1) is null then
    raise exception 'Debe incluir al menos un servicio';
  end if;

  p_metodo_pago   := nullif(p_metodo_pago, '');
  p_observaciones := nullif(btrim(p_observaciones), '');
  if p_metodo_pago is not null
     and p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  if p_empleado_id is null then
    raise exception 'Debe asignar un empleado';
  end if;

  select porcentaje_comision into v_comision
  from public.empleados where id = p_empleado_id and activo = true;
  if not found then
    raise exception 'Empleado inválido o inactivo';
  end if;

  select coalesce(sum(precio), 0), count(*) into v_total, v_count
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_count = 0 then
    raise exception 'Ningún servicio válido/activo en la selección';
  end if;

  -- Override del total: lo puede ajustar cualquier usuario con sesión.
  if p_total_override is not null then
    if p_total_override < 0 then
      raise exception 'Total inválido';
    end if;
    v_total := p_total_override;
  end if;

  insert into public.ordenes
    (cliente_id, vehiculo_id, placa, estado, metodo_pago, total, foto_url, observaciones, created_by)
  values
    (p_cliente_id, p_vehiculo_id, p_placa, 'en_proceso', p_metodo_pago, v_total, p_foto_url, p_observaciones, v_uid)
  returning id into v_orden_id;

  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, v_comision
  from public.servicios s
  where s.id = any(p_servicio_ids) and s.activo = true;

  if p_metodo_pago is not null then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, orden_id, created_by)
    values ('ingreso', 'Orden ' || coalesce(p_placa,''), p_metodo_pago, v_total, v_orden_id, v_uid);
  end if;

  return jsonb_build_object(
    'orden_id', v_orden_id,
    'total', v_total,
    'items', v_count,
    'cobrada', (p_metodo_pago is not null)
  );
end;
$$;

grant execute on function
  public.crear_orden(uuid[], uuid, text, text, uuid, uuid, text, text, numeric)
  to authenticated;

commit;
