-- ============================================================================
-- CAR WASH SERVICES — Migración 0045: nómina por días elegidos y salario fijo
-- que se descuenta en el cierre, no en la caja del día.
--
-- Pedidos del negocio:
--   · El salario fijo (Diego) no sale del cajón del día: no tiene que bajar el
--     "Total en caja" del turno, pero sí restar del total general del cierre,
--     en la columna Nómina.
--   · Al pagar la quincena se puede cambiar el monto (faltó días, un extra…).
--   · Hay trabajadores que cobran semanal: se eligen los días trabajados que
--     falten por pagar y se pagan juntos, en un solo egreso.
--
-- Cómo queda:
--   1) nomina_liquidaciones.dias: los días que se pagaron cuando se eligieron a
--      mano (nulo = todo el rango fecha_inicio–fecha_fin, como hasta ahora).
--   2) El egreso del salario lleva el concepto 'Nómina fija: …'. Al cerrar cae
--      en total_nomina (cerrar_caja suma todo lo que empieza por 'Nómina') y
--      la pantalla de Caja lo deja fuera del total del día. Backfill de los
--      pagos de salario ya hechos.
--   3) liquidar_salario(…, p_monto): monto editable; nulo = la quincena.
--   4) eliminar_liquidacion: reconoce el concepto 'Nómina fija: …'.
--   5) detalle_nomina(…, p_dias): con días, solo las órdenes de esos días.
--   6) dias_pendientes_nomina(): días trabajados que aún no se le pagan.
--   7) liquidar_nomina_dias(): paga los días elegidos. Un día no se paga dos
--      veces.
--
-- Aplicar DESPUÉS de las migraciones 0001–0044. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Días pagados en cada liquidación (si se eligieron a mano).
-- ---------------------------------------------------------------------------
alter table public.nomina_liquidaciones
  add column if not exists dias date[];

comment on column public.nomina_liquidaciones.dias is
  'Días pagados cuando se eligieron uno por uno. Nulo = todo el rango fecha_inicio–fecha_fin.';

-- ---------------------------------------------------------------------------
-- 2) Backfill: los egresos de salario ya registrados pasan a 'Nómina fija: …'.
--    Cerrados o no, siguen contando como nómina en el cierre (empiezan por
--    'Nómina'), así que ningún total cambia.
-- ---------------------------------------------------------------------------
update public.caja_movimientos m
   set concepto = 'Nómina fija: ' || substr(m.concepto, length('Nómina: ') + 1)
  from public.nomina_liquidaciones l
  join public.empleados e on e.id = l.empleado_id
 where l.tipo = 'salario'
   and m.tipo = 'egreso'
   and m.orden_id is null
   and m.monto = l.total_pagar
   and m.concepto = 'Nómina: ' || e.nombre || ' ('
                    || to_char(l.fecha_inicio, 'DD/MM') || '–'
                    || to_char(l.fecha_fin, 'DD/MM') || ')';

-- ---------------------------------------------------------------------------
-- 3) liquidar_salario con monto editable. Se borra la firma de 4 parámetros
--    para que la llamada no sea ambigua.
-- ---------------------------------------------------------------------------
drop function if exists public.liquidar_salario(uuid, date, date, text);

create or replace function public.liquidar_salario(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date,
  p_metodo_pago  text default 'efectivo',
  p_monto        numeric default null
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_emp   public.empleados;
  v_pagar numeric;
  v_row   public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;
  if p_fecha_fin < p_fecha_inicio then
    raise exception 'El periodo está al revés';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;
  if p_monto is not null and p_monto <= 0 then
    raise exception 'El monto a pagar debe ser mayor que cero';
  end if;

  -- Se bloquea al trabajador para que dos clics no paguen la quincena dos veces.
  select * into v_emp from public.empleados where id = p_empleado_id for update;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;
  if v_emp.tipo_pago <> 'salario' then
    raise exception '% gana por comisión: liquídalo en la nómina normal.', v_emp.nombre;
  end if;

  -- Una quincena se paga una sola vez.
  if exists (
    select 1 from public.nomina_liquidaciones l
    where l.empleado_id = p_empleado_id
      and l.tipo = 'salario'
      and l.fecha_inicio <= p_fecha_fin
      and l.fecha_fin   >= p_fecha_inicio
  ) then
    raise exception 'A % ya se le pagó esa quincena.', v_emp.nombre;
  end if;

  v_pagar := coalesce(round(p_monto),
                      round((v_emp.salario_mensual + v_emp.auxilio_transporte) / 2.0));

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado,
     porcentaje, total_pagar, tipo)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, 0, 0, 0, v_pagar, 'salario')
  returning * into v_row;

  -- 'Nómina fija': resta en el cierre (columna Nómina), no en la caja del día.
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
  values ('egreso',
          'Nómina fija: ' || v_emp.nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
          p_metodo_pago, v_pagar, 'principal', v_uid);

  return v_row;
end;
$$;

comment on function public.liquidar_salario(uuid, date, date, text, numeric) is
  'Paga una quincena a un trabajador de salario fijo (monto editable; nulo = (salario + auxilio) / 2). Egreso ''Nómina fija'' que resta en el cierre.';

grant execute on function public.liquidar_salario(uuid, date, date, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) eliminar_liquidacion: igual a la 0042, con el concepto del salario fijo.
-- ---------------------------------------------------------------------------
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
  v_concepto := case when v_liq.tipo = 'salario' then 'Nómina fija: ' else 'Nómina: ' end
                || coalesce(v_nombre, '') || ' ('
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
-- 5) detalle_nomina con días opcionales. Se borra la firma de 3 parámetros:
--    las llamadas con 3 argumentos siguen funcionando por el default.
-- ---------------------------------------------------------------------------
drop function if exists public.detalle_nomina(uuid, date, date);

create or replace function public.detalle_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date,
  p_dias         date[] default null
)
returns table (
  orden_id  uuid,
  fecha     timestamptz,
  placa     text,
  total     numeric,
  servicios text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  return query
    select o.id,
           o.created_at,
           o.placa,
           o.total,
           -- Los servicios de esa orden que hizo ESTE empleado, alfabéticos.
           string_agg(s.nombre, ', ' order by s.nombre) as servicios
      from public.ordenes o
      join public.orden_items oi on oi.orden_id = o.id
      join public.servicios   s  on s.id = oi.servicio_id
     where oi.empleado_id = p_empleado_id
       and (o.created_at at time zone 'America/Bogota')::date
           between p_fecha_inicio and p_fecha_fin
       and (p_dias is null
            or (o.created_at at time zone 'America/Bogota')::date = any(p_dias))
     group by o.id, o.created_at, o.placa, o.total
     order by o.created_at;
end;
$$;

comment on function public.detalle_nomina(uuid, date, date, date[]) is
  'Órdenes y servicios que atendió un empleado en un rango (y solo en p_dias si se da). Detalle de una liquidación.';

grant execute on function public.detalle_nomina(uuid, date, date, date[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) dias_pendientes_nomina: días (últimos 60) en que el trabajador atendió
--    órdenes y que ninguna liquidación por comisión cubre todavía.
-- ---------------------------------------------------------------------------
create or replace function public.dias_pendientes_nomina(p_empleado_id uuid)
returns table (
  dia     date,
  ordenes int,
  total   numeric
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
    with ordenes_del_empleado as (
      -- Una orden cuenta una vez aunque tenga varios ítems del empleado.
      select distinct o.id, o.total,
             (o.created_at at time zone 'America/Bogota')::date as d
        from public.ordenes o
        join public.orden_items oi on oi.orden_id = o.id
       where oi.empleado_id = p_empleado_id
         and (o.created_at at time zone 'America/Bogota')::date between v_hoy - 60 and v_hoy
    )
    select x.d, count(*)::int, coalesce(sum(x.total), 0)
      from ordenes_del_empleado x
     where not exists (
       select 1 from public.nomina_liquidaciones l
        where l.empleado_id = p_empleado_id
          and l.tipo = 'comision'
          and (case when l.dias is null
                    then x.d between l.fecha_inicio and l.fecha_fin
                    else x.d = any(l.dias) end)
     )
     group by x.d
     order by x.d;
end;
$$;

comment on function public.dias_pendientes_nomina(uuid) is
  'Días de los últimos 60 con órdenes del trabajador que aún no tienen liquidación por comisión.';

grant execute on function public.dias_pendientes_nomina(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) liquidar_nomina_dias: paga por comisión los días elegidos, en una sola
--    liquidación y un solo egreso de la caja principal (cae en la columna
--    Nómina, como siempre). Un día ya pagado no se puede volver a pagar; eso
--    reemplaza al tope de "una vez al día" para este camino.
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_nomina_dias(
  p_empleado_id uuid,
  p_dias        date[],
  p_metodo_pago text default 'efectivo'
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_emp       public.empleados;
  v_dias      date[];
  v_inicio    date;
  v_fin       date;
  v_servicios int := 0;
  v_facturado numeric := 0;
  v_pagar     numeric := 0;
  v_row       public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_empleado_id is null or p_dias is null or cardinality(p_dias) = 0 then
    raise exception 'Elige al menos un día';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  -- Se bloquea al trabajador para que dos clics no paguen los mismos días.
  select * into v_emp from public.empleados where id = p_empleado_id for update;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;
  if v_emp.tipo_pago = 'salario' then
    raise exception '% tiene salario fijo: se paga en la nómina de salario, no por comisión.', v_emp.nombre;
  end if;

  select array_agg(distinct d order by d) into v_dias
    from unnest(p_dias) as d where d is not null;
  if v_dias is null then
    raise exception 'Elige al menos un día';
  end if;
  v_inicio := v_dias[1];
  v_fin    := v_dias[cardinality(v_dias)];

  if exists (
    select 1
      from unnest(v_dias) as d
      join public.nomina_liquidaciones l
        on l.empleado_id = p_empleado_id
       and l.tipo = 'comision'
       and (case when l.dias is null
                 then d between l.fecha_inicio and l.fecha_fin
                 else d = any(l.dias) end)
  ) then
    raise exception 'Alguno de esos días ya se le pagó a %. Recarga la página.', v_emp.nombre;
  end if;

  -- Una orden = 1 servicio y su total real se cuenta una sola vez.
  select coalesce(sum(x.total), 0), count(*)
    into v_facturado, v_servicios
  from (
    select o.id, o.total
      from public.ordenes o
      join public.orden_items oi on oi.orden_id = o.id
     where oi.empleado_id = p_empleado_id
       and (o.created_at at time zone 'America/Bogota')::date = any(v_dias)
     group by o.id, o.total
  ) x;

  v_pagar := round(v_facturado * v_emp.porcentaje_comision / 100.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado,
     porcentaje, total_pagar, dias)
  values
    (p_empleado_id, v_inicio, v_fin, v_servicios, v_facturado,
     v_emp.porcentaje_comision, v_pagar, v_dias)
  returning * into v_row;

  -- Mismo concepto que liquidar_nomina: eliminar_liquidacion lo reconoce.
  if v_pagar > 0 then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
    values ('egreso',
            'Nómina: ' || v_emp.nombre || ' (' || to_char(v_inicio,'DD/MM') || '–' || to_char(v_fin,'DD/MM') || ')',
            p_metodo_pago, v_pagar, 'principal', v_uid);
  end if;

  return v_row;
end;
$$;

comment on function public.liquidar_nomina_dias(uuid, date[], text) is
  'Liquida por comisión los días elegidos (pago semanal, etc.) + un egreso en caja. Un día no se paga dos veces.';

grant execute on function public.liquidar_nomina_dias(uuid, date[], text) to authenticated;

commit;
