-- ============================================================================
-- CAR WASH SERVICES — Migración 0032: nómina una vez al día + aviso de pendientes
--
-- Dos cosas pedidas por el negocio:
--
--   1) A cada trabajador se le liquida UNA SOLA VEZ AL DÍA. Antes se podía
--      liquidar el mismo empleado varias veces seguidas (por ejemplo, dándole
--      dos veces al botón), y cada intento generaba otra liquidación y otro
--      egreso en la caja: plata pagada dos veces. Ahora el servidor lo rechaza
--      con un mensaje claro.
--      El día se evalúa en hora Colombia, igual que el resto del sistema.
--
--   2) `empleados_pendientes_liquidar()`: quiénes trabajaron HOY y todavía no
--      tienen su liquidación del día. Alimenta el aviso de "falta liquidar" del
--      Dashboard y de la pantalla de Nómina.
--
-- Nota: el límite es por DÍA DE LIQUIDACIÓN (cuándo se liquidó), no por el rango
-- liquidado. Se puede liquidar cualquier periodo, pero una sola vez por jornada.
--
-- Aplicar DESPUÉS de la migración 0031. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) liquidar_nomina: se agrega el tope de una liquidación por empleado y día.
--    Todo lo demás es igual a la 0031 (abierta a cualquier usuario con sesión,
--    una orden = 1 servicio, se factura el total real y el pago sale como
--    egreso de la caja principal).
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
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
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

  -- UNA LIQUIDACIÓN POR EMPLEADO Y POR DÍA (evita pagar dos veces lo mismo).
  if exists (
    select 1 from public.nomina_liquidaciones l
    where l.empleado_id = p_empleado_id
      and (l.created_at at time zone 'America/Bogota')::date = v_hoy
  ) then
    raise exception 'A % ya se le liquidó hoy. Solo se puede liquidar una vez al día.', v_nombre;
  end if;

  -- Una orden = 1 servicio: se agrupa por orden y se cuentan las órdenes.
  -- El facturado es el total real de cada orden, una sola vez.
  select coalesce(sum(x.total), 0), count(*)
    into v_facturado, v_servicios
  from (
    select o.id, o.total
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

comment on function public.liquidar_nomina(uuid, date, date, text) is
  'Liquida la comisión de un empleado + egreso en caja. Una sola vez por empleado y día (hora Colombia).';

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) empleados_pendientes_liquidar: trabajadores con órdenes de HOY que todavía
--    no tienen liquidación de hoy. Es lo que alimenta el aviso de la app.
--
--    Se cuenta por ORDEN (no por ítem): una orden con tres servicios es una
--    sola orden y su total se suma una sola vez, igual que en liquidar_nomina.
-- ---------------------------------------------------------------------------
create or replace function public.empleados_pendientes_liquidar()
returns table (
  empleado_id uuid,
  nombre      text,
  ordenes     int,
  total       numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  return query
    with ordenes_de_hoy as (
      -- distinct: si la orden tiene varios ítems del mismo empleado, cuenta una
      -- sola vez. Las columnas se renombran (emp_id/monto) para no chocar con
      -- los parámetros de salida de la función.
      select distinct oi.empleado_id as emp_id, o.id as orden_id, o.total as monto
        from public.ordenes o
        join public.orden_items oi on oi.orden_id = o.id
       where oi.empleado_id is not null
         and (o.created_at at time zone 'America/Bogota')::date = v_hoy
    )
    select e.id,
           e.nombre,
           count(*)::int,
           coalesce(sum(x.monto), 0)
      from ordenes_de_hoy x
      join public.empleados e on e.id = x.emp_id
     where e.activo = true
       and not exists (
         select 1 from public.nomina_liquidaciones l
         where l.empleado_id = e.id
           and (l.created_at at time zone 'America/Bogota')::date = v_hoy
       )
     group by e.id, e.nombre
     order by e.nombre;
end;
$$;

comment on function public.empleados_pendientes_liquidar() is
  'Trabajadores con órdenes de hoy que aún no tienen liquidación de hoy (aviso "falta liquidar").';

grant execute on function public.empleados_pendientes_liquidar() to authenticated;

commit;
