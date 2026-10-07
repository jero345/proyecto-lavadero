-- ============================================================================
-- CAR WASH SERVICES — Migración 0042: los préstamos NO tocan la caja.
--
-- Corrección de la 0039: los préstamos a trabajadores son un control aparte —
-- un cuaderno de quién debe cuánto— que el dueño maneja por su lado. No son
-- plata del negocio, así que no mueven la caja por ningún lado:
--   · prestar NO genera egreso,
--   · abonar  NO genera ingreso,
--   · la nómina se liquida COMPLETA (se le quita el descuento de préstamo).
--
--   1) guardar_prestamo  — sin egreso; si el préstamo traía uno, se borra.
--   2) abonar_prestamo   — sin ingreso; el método de pago deja de pedirse.
--   3) eliminar_prestamo / eliminar_abono — sin movimientos que deshacer.
--   4) liquidar_nomina   — vuelve a la firma de 4 parámetros, sin descuento.
--   5) Limpieza: se borran los movimientos de caja que la 0039 hubiera creado
--      por préstamos o abonos, siempre que no estén dentro de un cierre.
--
-- `nomina_liquidaciones.abono_prestamo` se conserva (queda en 0 de aquí en
-- adelante) para no perder lo que se haya liquidado con descuento.
--
-- Aplicar DESPUÉS de las migraciones 0001–0041. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) El método de pago deja de ser obligatorio: ya no hay plata de por medio.
-- ---------------------------------------------------------------------------
alter table public.prestamos alter column metodo_pago drop not null;

comment on table public.prestamos is
  'Préstamos a los trabajadores. Control aparte: NO mueven la caja del negocio.';

-- ---------------------------------------------------------------------------
-- 1) guardar_prestamo: solo el registro.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_prestamo(
  p_id          uuid,
  p_empleado_id uuid,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text default null,
  p_concepto    text default null
)
returns public.prestamos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_prestamo public.prestamos;
  v_abonado  numeric;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'Monto inválido';
  end if;
  if p_fecha is null then
    raise exception 'La fecha es obligatoria';
  end if;
  if not exists (select 1 from public.empleados where id = p_empleado_id) then
    raise exception 'Trabajador no encontrado';
  end if;

  if p_id is null then
    insert into public.prestamos (empleado_id, monto, fecha, metodo_pago, concepto, created_by)
    values (p_empleado_id, p_monto, p_fecha, p_metodo_pago, nullif(btrim(p_concepto), ''), v_uid)
    returning * into v_prestamo;
  else
    -- No se puede bajar el monto por debajo de lo que ya abonó.
    select coalesce(sum(monto), 0) into v_abonado
      from public.prestamo_abonos where prestamo_id = p_id;
    if p_monto < v_abonado then
      raise exception 'El préstamo ya tiene % abonados: el monto no puede ser menor', v_abonado;
    end if;

    update public.prestamos
       set empleado_id = p_empleado_id,
           monto       = p_monto,
           fecha       = p_fecha,
           metodo_pago = p_metodo_pago,
           concepto    = nullif(btrim(p_concepto), '')
     where id = p_id
    returning * into v_prestamo;
    if not found then
      raise exception 'Préstamo no encontrado';
    end if;
  end if;

  -- Si venía de la versión vieja con egreso en caja, se suelta (y se borra si
  -- todavía no está cerrado): este préstamo ya no es plata del negocio.
  if v_prestamo.caja_movimiento_id is not null then
    delete from public.caja_movimientos
     where id = v_prestamo.caja_movimiento_id and cierre_id is null;

    update public.prestamos set caja_movimiento_id = null
     where id = v_prestamo.id
    returning * into v_prestamo;
  end if;

  return v_prestamo;
end;
$$;

comment on function public.guardar_prestamo(uuid, uuid, numeric, date, text, text) is
  'Alta/edición de un préstamo a un trabajador. Solo registro: no mueve la caja.';

grant execute on function public.guardar_prestamo(uuid, uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) abonar_prestamo: solo el registro del abono.
-- ---------------------------------------------------------------------------
create or replace function public.abonar_prestamo(
  p_prestamo_id uuid,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text default null
)
returns public.prestamo_abonos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_saldo numeric;
  v_row   public.prestamo_abonos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'Monto inválido';
  end if;

  -- Se bloquea la fila para que dos abonos a la vez no se pasen del saldo.
  perform 1 from public.prestamos where id = p_prestamo_id for update;
  if not found then
    raise exception 'Préstamo no encontrado';
  end if;

  v_saldo := public.saldo_prestamo(p_prestamo_id);
  if p_monto > v_saldo then
    raise exception 'El abono supera el saldo pendiente (%)', v_saldo;
  end if;

  insert into public.prestamo_abonos
    (prestamo_id, monto, fecha, metodo_pago, origen, created_by)
  values
    (p_prestamo_id, p_monto,
     coalesce(p_fecha, (now() at time zone 'America/Bogota')::date),
     p_metodo_pago, 'manual', v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.abonar_prestamo(uuid, numeric, date, text) is
  'Abono a un préstamo. Solo registro: no entra plata a la caja.';

grant execute on function public.abonar_prestamo(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Borrados: ya no hay movimientos de caja que deshacer.
-- ---------------------------------------------------------------------------
create or replace function public.eliminar_abono(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.prestamo_abonos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;

  select * into v_row from public.prestamo_abonos where id = p_id;
  if not found then
    raise exception 'Abono no encontrado';
  end if;

  -- Si el abono venía de la versión vieja con ingreso en caja, se borra si aún
  -- no está cerrado.
  if v_row.caja_movimiento_id is not null then
    delete from public.caja_movimientos
     where id = v_row.caja_movimiento_id and cierre_id is null;
  end if;

  delete from public.prestamo_abonos where id = p_id;
end;
$$;

grant execute on function public.eliminar_abono(uuid) to authenticated;

create or replace function public.eliminar_prestamo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.prestamos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;

  select * into v_row from public.prestamos where id = p_id;
  if not found then
    raise exception 'Préstamo no encontrado';
  end if;

  -- Movimientos de caja de la versión vieja (préstamo y abonos), si siguen abiertos.
  delete from public.caja_movimientos
   where cierre_id is null
     and id in (select caja_movimiento_id from public.prestamo_abonos
                 where prestamo_id = p_id and caja_movimiento_id is not null);

  if v_row.caja_movimiento_id is not null then
    delete from public.caja_movimientos
     where id = v_row.caja_movimiento_id and cierre_id is null;
  end if;

  -- Los abonos se van en cascada con el préstamo.
  delete from public.prestamos where id = p_id;
end;
$$;

grant execute on function public.eliminar_prestamo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) liquidar_nomina: sin descuento de préstamo. Vuelve a la firma de la 0032
--    (la de 5 parámetros se elimina para que la llamada no sea ambigua).
-- ---------------------------------------------------------------------------
drop function if exists public.liquidar_nomina(uuid, date, date, text, numeric);

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
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado,
     porcentaje, total_pagar)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado,
     v_porcentaje, v_pagar)
  returning * into v_row;

  -- El pago de la nómina sale COMPLETO como egreso de la caja principal.
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
  'Liquida la comisión de un empleado + egreso en caja por el total. Una vez por empleado y día. Los préstamos no entran acá (mig. 0042).';

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

-- eliminar_liquidacion: el egreso vuelve a ser por el total de la liquidación.
create or replace function public.eliminar_liquidacion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_liq      public.nomina_liquidaciones;
  v_nombre   text;
  v_concepto text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;

  select * into v_liq from public.nomina_liquidaciones where id = p_id;
  if not found then
    raise exception 'Liquidación no encontrada';
  end if;

  select nombre into v_nombre from public.empleados where id = v_liq.empleado_id;
  v_concepto := 'Nómina: ' || coalesce(v_nombre, '') || ' ('
                || to_char(v_liq.fecha_inicio, 'DD/MM') || '–'
                || to_char(v_liq.fecha_fin, 'DD/MM') || ')';

  -- El egreso se borra solo si sigue abierto. El monto es el total, salvo las
  -- liquidaciones viejas que se hicieron con descuento de préstamo (mig. 0039).
  delete from public.caja_movimientos
   where cierre_id is null
     and orden_id is null
     and tipo = 'egreso'
     and concepto = v_concepto
     and monto = v_liq.total_pagar - coalesce(v_liq.abono_prestamo, 0);

  -- Lo que se le hubiera descontado en nómina vuelve a quedar debiendo.
  delete from public.prestamo_abonos where liquidacion_id = p_id and origen = 'nomina';

  delete from public.nomina_liquidaciones where id = p_id;
end;
$$;

grant execute on function public.eliminar_liquidacion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Limpieza: fuera de la caja los movimientos que generó la versión 0039.
--    Solo los que todavía no entraron en un cierre (un cierre cuadrado no se
--    toca; si hubiera alguno, queda como un movimiento suelto más).
-- ---------------------------------------------------------------------------
delete from public.caja_movimientos
 where cierre_id is null
   and id in (
     select caja_movimiento_id from public.prestamos       where caja_movimiento_id is not null
     union
     select caja_movimiento_id from public.prestamo_abonos where caja_movimiento_id is not null
   );

update public.prestamos set caja_movimiento_id = null
 where caja_movimiento_id is not null
   and not exists (select 1 from public.caja_movimientos m where m.id = caja_movimiento_id);

update public.prestamo_abonos set caja_movimiento_id = null
 where caja_movimiento_id is not null
   and not exists (select 1 from public.caja_movimientos m where m.id = caja_movimiento_id);

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- Debe devolver 0: ningún préstamo ni abono con movimiento de caja.
--   select (select count(*) from public.prestamos       where caja_movimiento_id is not null)
--        + (select count(*) from public.prestamo_abonos where caja_movimiento_id is not null);
--
--   -- liquidar_nomina debe tener 4 parámetros:
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'liquidar_nomina';
-- ============================================================================
