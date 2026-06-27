-- ============================================================================
-- CAR WASH SERVICES — Migración 0005: Órdenes agendadas (cobrar después)
-- Permite registrar una orden SIN método de pago (queda "pendiente de cobro")
-- y cobrarla más tarde. Idempotente (create or replace).
--   - crear_orden:  si p_metodo_pago es null/'', NO crea movimiento de caja.
--   - cobrar_orden: registra el pago de una orden pendiente + ingreso a caja.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- crear_orden: ahora el método de pago es OPCIONAL.
--   * Con método  -> crea la orden + ingreso a caja (como antes).
--   * Sin método  -> crea la orden SIN tocar caja (queda agendada/pendiente).
-- Mantiene la misma firma (uuid[], uuid, text, text, uuid, uuid, text).
-- ---------------------------------------------------------------------------
create or replace function public.crear_orden(
  p_servicio_ids uuid[],
  p_empleado_id  uuid,
  p_metodo_pago  text,
  p_placa        text,
  p_cliente_id   uuid default null,
  p_vehiculo_id  uuid default null,
  p_foto_url     text default null
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

  -- Normaliza: '' -> null. El método ahora es opcional (orden agendada).
  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is not null
     and p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  if p_empleado_id is null then
    raise exception 'Debe asignar un empleado';
  end if;

  -- Un empleado solo puede registrar órdenes a su propio nombre; el staff puede
  -- asignar a cualquiera. NUNCA se confía en el cliente para esto (anti-fraude).
  if not public.is_staff() then
    p_empleado_id := v_uid;
  end if;

  -- % de comisión del empleado (debe existir y estar activo).
  select porcentaje_comision into v_comision
  from public.profiles where id = p_empleado_id and activo = true;
  if not found then
    raise exception 'Empleado inválido o inactivo';
  end if;

  -- Total = suma de precios REALES del catálogo (no del cliente).
  select coalesce(sum(precio), 0), count(*) into v_total, v_count
  from public.servicios
  where id = any(p_servicio_ids) and activo = true;

  if v_count = 0 then
    raise exception 'Ningún servicio válido/activo en la selección';
  end if;

  -- Cabecera de la orden (metodo_pago puede quedar null = pendiente de cobro).
  insert into public.ordenes (cliente_id, vehiculo_id, placa, estado, metodo_pago, total, foto_url, created_by)
  values (p_cliente_id, p_vehiculo_id, p_placa, 'en_proceso', p_metodo_pago, v_total, p_foto_url, v_uid)
  returning id into v_orden_id;

  -- Ítems (un registro por servicio, con el precio del catálogo).
  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, v_comision
  from public.servicios s
  where s.id = any(p_servicio_ids) and s.activo = true;

  -- Ingreso a caja SOLO si ya se cobró (hay método de pago). Si está agendada,
  -- el ingreso se crea luego con cobrar_orden().
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

grant execute on function public.crear_orden(uuid[], uuid, text, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cobrar_orden: registra el pago de una orden pendiente (metodo_pago null),
-- fija el método y crea el ingreso a caja por el total. Atómico.
-- Permitido al staff o al creador de la orden. Evita doble cobro.
-- ---------------------------------------------------------------------------
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

  if not (public.is_staff() or v_row.created_by = v_uid) then
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
