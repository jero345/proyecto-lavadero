-- ============================================================================
-- CAR WASH SERVICES — Migración 0003: Lógica sensible del servidor (Fase 6)
-- Funciones SECURITY DEFINER (atómicas). El frontend las llama con supabase.rpc().
--   - crear_orden:     calcula el total en el servidor + inserta ingreso a caja.
--   - cerrar_caja:     consolida los movimientos abiertos en un cierre.
--   - liquidar_nomina: liquida comisiones de un empleado en un rango.
-- NUNCA se confía en montos del cliente: los precios salen de la tabla servicios.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- crear_orden: crea la orden, sus ítems y el ingreso a caja en UNA transacción.
-- p_servicio_ids: servicios seleccionados (sus precios se leen del servidor).
-- Devuelve { orden_id, total }.
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
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
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

  -- Cabecera de la orden.
  insert into public.ordenes (cliente_id, vehiculo_id, placa, estado, metodo_pago, total, foto_url, created_by)
  values (p_cliente_id, p_vehiculo_id, p_placa, 'en_proceso', p_metodo_pago, v_total, p_foto_url, v_uid)
  returning id into v_orden_id;

  -- Ítems (un registro por servicio, con el precio del catálogo).
  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, v_comision
  from public.servicios s
  where s.id = any(p_servicio_ids) and s.activo = true;

  -- Ingreso automático a caja por el total de la orden.
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, orden_id, created_by)
  values ('ingreso', 'Orden ' || coalesce(p_placa,''), p_metodo_pago, v_total, v_orden_id, v_uid);

  return jsonb_build_object('orden_id', v_orden_id, 'total', v_total, 'items', v_count);
end;
$$;

grant execute on function public.crear_orden(uuid[], uuid, text, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cerrar_caja: agrupa los movimientos sin cierre desde la última apertura,
-- crea el cierre, marca esos movimientos con el cierre_id y devuelve el resumen.
-- Solo staff (admin / super_admin).
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_caja()
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_row    public.cierres_caja;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;

  -- Evita cierres "fantasma" (total 0) si no hay nada que cerrar (doble click).
  if not exists (select 1 from public.caja_movimientos where cierre_id is null) then
    raise exception 'No hay movimientos para cerrar';
  end if;

  -- Crea el cierre (totales se completan tras consolidar los movimientos).
  insert into public.cierres_caja (created_by) values (v_uid) returning id into v_id;

  -- Consolida en un solo statement: marca movimientos abiertos y agrega totales.
  with abiertos as (
    update public.caja_movimientos
       set cierre_id = v_id
     where cierre_id is null
    returning tipo, metodo_pago, monto, created_at
  )
  update public.cierres_caja c set
    total_efectivo      = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='efectivo'), 0),
    total_qr            = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='qr'), 0),
    total_transferencia = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='transferencia'), 0),
    total_egresos       = coalesce((select sum(monto) from abiertos where tipo='egreso'), 0),
    total_general       = coalesce((select sum(monto) from abiertos where tipo='ingreso'), 0)
                          - coalesce((select sum(monto) from abiertos where tipo='egreso'), 0),
    fecha_apertura      = coalesce((select min(created_at) from abiertos), now()),
    fecha_cierre        = now()
  where c.id = v_id
  returning c.* into v_row;

  return v_row;
end;
$$;

grant execute on function public.cerrar_caja() to authenticated;

-- ---------------------------------------------------------------------------
-- liquidar_nomina: suma los orden_items de un empleado en un rango de fechas,
-- aplica su % de comisión, crea la liquidación y devuelve el resumen.
-- Solo staff. El rango se calcula por la fecha de la orden (ordenes.created_at).
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_porcentaje numeric;
  v_servicios  int := 0;
  v_facturado  numeric := 0;
  v_pagar      numeric := 0;
  v_row        public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;

  -- El empleado debe existir (se permite liquidar a inactivos: pagos pendientes).
  select porcentaje_comision into v_porcentaje
  from public.profiles where id = p_empleado_id;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;

  select count(*), coalesce(sum(oi.precio), 0)
    into v_servicios, v_facturado
  from public.orden_items oi
  join public.ordenes o on o.id = oi.orden_id
  where oi.empleado_id = p_empleado_id
    and (o.created_at at time zone 'America/Bogota')::date between p_fecha_inicio and p_fecha_fin;

  v_pagar := round(v_facturado * v_porcentaje / 100.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado, porcentaje, total_pagar)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado, v_porcentaje, v_pagar)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.liquidar_nomina(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- avanzar_estado_orden: cambia SOLO el estado (en_proceso -> completado ->
-- entregado). Evita que un empleado altere total/metodo_pago por la API REST.
-- Permitido al staff o al creador de la orden.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- registrar_movimiento_inventario: ajusta el stock de forma ATÓMICA y registra
-- el movimiento en una sola transacción. Solo staff. Evita "lost updates".
-- ---------------------------------------------------------------------------
create or replace function public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_tipo        text,
  p_cantidad    numeric
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.productos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;
  if p_tipo not in ('entrada','salida') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  -- Update atómico: el saldo se calcula en la BD; salida bloquea si no alcanza.
  update public.productos
     set stock_actual = stock_actual
       + (case when p_tipo = 'entrada' then p_cantidad else -p_cantidad end)
   where id = p_producto_id
     and (p_tipo = 'entrada' or stock_actual >= p_cantidad)
  returning * into v_row;

  if not found then
    raise exception 'Stock insuficiente o producto inexistente';
  end if;

  insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
  values (p_producto_id, p_tipo, p_cantidad, v_uid);

  return v_row;
end;
$$;

grant execute on function public.registrar_movimiento_inventario(uuid, text, numeric) to authenticated;

commit;
