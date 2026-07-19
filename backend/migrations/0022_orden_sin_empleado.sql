-- ============================================================================
-- CAR WASH SERVICES — Migración 0022: Orden sin empleado + liquidar por total
-- Dos cambios pedidos por el negocio:
--   1) Se puede CREAR una orden SIN asignar empleado (se asigna luego desde el
--      Dashboard con el nuevo RPC asignar_empleado_orden). Antes era obligatorio.
--   2) La nómina (liquidar_nomina) ahora factura el TOTAL REAL de la orden
--      (ordenes.total, que incluye el valor editado/override), no la suma de los
--      precios de catálogo de los ítems. Antes, si se editaba el "Total a cobrar",
--      ese valor no se liquidaba.
--
-- Modelo: una orden = un empleado (todos sus ítems comparten empleado_id). Por
-- eso el total de la orden se atribuye una sola vez al empleado asignado.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) orden_items.empleado_id ahora es OPCIONAL (orden sin empleado asignado).
--    La FK a empleados se conserva; solo se quita el NOT NULL.
-- ---------------------------------------------------------------------------
alter table public.orden_items
  alter column empleado_id drop not null;

-- ---------------------------------------------------------------------------
-- 2) crear_orden: el empleado pasa a ser OPCIONAL.
--    Si se envía, debe existir y estar activo (y define la comisión de los
--    ítems). Si no, la orden queda "sin asignar" y se completa desde el
--    Dashboard. El total/override no cambia de comportamiento.
-- ---------------------------------------------------------------------------
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

  -- Empleado OPCIONAL: si viene, debe existir y estar activo (y define comisión).
  if p_empleado_id is not null then
    select porcentaje_comision into v_comision
    from public.empleados where id = p_empleado_id and activo = true;
    if not found then
      raise exception 'Empleado inválido o inactivo';
    end if;
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

  -- Ítems con el precio del catálogo. empleado_id puede ir NULL (sin asignar);
  -- comision_porcentaje (NOT NULL) usa la del empleado o 40 como placeholder
  -- (se reemplaza al asignar el empleado desde el Dashboard).
  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, coalesce(v_comision, 40)
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

-- ---------------------------------------------------------------------------
-- 3) asignar_empleado_orden: asigna (o cambia) el empleado de una orden.
--    Actualiza TODOS los ítems de la orden al empleado elegido y sincroniza la
--    comisión guardada. Lo puede hacer cualquier usuario con sesión.
-- ---------------------------------------------------------------------------
create or replace function public.asignar_empleado_orden(
  p_orden_id    uuid,
  p_empleado_id uuid
)
returns public.ordenes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_comision numeric;
  v_row      public.ordenes;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_orden_id is null or p_empleado_id is null then
    raise exception 'Parámetros incompletos';
  end if;

  select porcentaje_comision into v_comision
  from public.empleados where id = p_empleado_id and activo = true;
  if not found then
    raise exception 'Empleado inválido o inactivo';
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  update public.orden_items
     set empleado_id = p_empleado_id,
         comision_porcentaje = v_comision
   where orden_id = p_orden_id;

  return v_row;
end;
$$;

grant execute on function public.asignar_empleado_orden(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) liquidar_nomina: factura el TOTAL REAL de la orden (con valor editado),
--    no la suma de precios de catálogo de los ítems.
--    - Servicios = # de ítems del empleado en el rango.
--    - Facturado = suma de ordenes.total (UNA vez por orden) de las órdenes del
--      empleado en el rango.
--    (Una orden = un empleado, por eso el total se atribuye completo al empleado.)
--    Mantiene el egreso en la caja principal (mig. 0016).
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date,
  p_metodo_pago  text default 'efectivo'
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_nombre     text;
  v_porcentaje numeric;
  v_servicios  int := 0;
  v_facturado  numeric := 0;
  v_pagar      numeric := 0;
  v_row        public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  select nombre, porcentaje_comision into v_nombre, v_porcentaje
  from public.empleados where id = p_empleado_id;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;

  -- Por orden: total real (una vez) + cuántos ítems atendió el empleado.
  select coalesce(sum(x.total), 0), coalesce(sum(x.n_items), 0)
    into v_facturado, v_servicios
  from (
    select o.id, o.total, count(oi.id) as n_items
    from public.ordenes o
    join public.orden_items oi on oi.orden_id = o.id
    where oi.empleado_id = p_empleado_id
      and (o.created_at at time zone 'America/Bogota')::date between p_fecha_inicio and p_fecha_fin
    group by o.id, o.total
  ) x;

  v_pagar := round(v_facturado * v_porcentaje / 100.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado, porcentaje, total_pagar)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado, v_porcentaje, v_pagar)
  returning * into v_row;

  -- El pago de la nómina sale como EGRESO de la caja principal (si hay monto).
  if v_pagar > 0 then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
    values ('egreso',
            'Nómina: ' || v_nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
            p_metodo_pago, v_pagar, 'principal', v_uid);
  end if;

  return v_row;
end;
$$;

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

commit;
