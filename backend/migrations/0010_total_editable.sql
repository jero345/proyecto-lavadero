-- ============================================================================
-- CAR WASH SERVICES — Migración 0010: Total final editable (override)
-- El staff puede fijar un total distinto al del catálogo (descuentos/recargos).
-- Los ítems conservan el precio del catálogo (para la comisión de nómina); solo
-- cambia el total de la orden y el ingreso a caja.
--
-- Esta migración es AUTOSUFICIENTE: incluye también la columna `observaciones`
-- (de la 0009) por si no se corrió, y deja UNA sola versión de crear_orden.
-- Idempotente.
-- ============================================================================

begin;

-- Columna de observaciones (idempotente; también estaba en 0009).
alter table public.ordenes
  add column if not exists observaciones text;

-- Elimina versiones previas de crear_orden para no dejar sobrecargas duplicadas.
drop function if exists public.crear_orden(uuid[], uuid, text, text, uuid, uuid, text);
drop function if exists public.crear_orden(uuid[], uuid, text, text, uuid, uuid, text, text);

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

  -- % de comisión del trabajador (roster), debe existir y estar activo.
  select porcentaje_comision into v_comision
  from public.empleados where id = p_empleado_id and activo = true;
  if not found then
    raise exception 'Empleado inválido o inactivo';
  end if;

  -- Total = suma de precios REALES del catálogo (base para validar y comisión).
  select coalesce(sum(precio), 0), count(*) into v_total, v_count
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_count = 0 then
    raise exception 'Ningún servicio válido/activo en la selección';
  end if;

  -- Override del total: SOLO staff puede ajustar el valor final a cobrar.
  -- (Anti-fraude: a un no-staff se le ignora el override y paga el del catálogo.)
  if p_total_override is not null and public.is_staff() then
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

  -- Ítems con el precio del CATÁLOGO (la comisión no depende del override).
  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, v_comision
  from public.servicios s
  where s.id = any(p_servicio_ids) and s.activo = true;

  -- Ingreso a caja SOLO si ya se cobró (usa el total final, con override si aplica).
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
