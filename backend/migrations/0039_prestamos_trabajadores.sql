-- ============================================================================
-- CAR WASH SERVICES — Migración 0039: préstamos a trabajadores.
--
-- Pedido del negocio: poder prestarle plata a un trabajador, llevarle los
-- abonos y el saldo, y poder descontarle el abono al liquidarle la nómina.
--
-- Cómo queda el dinero:
--   · Prestar        → EGRESO de la caja principal ('Préstamo: <nombre>').
--   · Abono en caja  → INGRESO de la caja principal ('Abono préstamo: <nombre>').
--   · Abono en nómina→ NO genera movimiento: la plata nunca sale del cajón.
--                      El egreso de la liquidación se registra por el NETO
--                      (a pagar − abono), que es lo que de verdad se entrega.
--
--   1) prestamos / prestamo_abonos (+ RLS: solo staff)
--   2) saldo_prestamo / saldo_prestamos_empleado
--   3) guardar_prestamo · eliminar_prestamo · abonar_prestamo · eliminar_abono
--   4) nomina_liquidaciones.abono_prestamo + liquidar_nomina con p_abono_prestamo
--      (reparte el abono entre los préstamos más viejos del trabajador)
--   5) eliminar_liquidacion: borra también los abonos que hizo esa liquidación
--      y busca su egreso por el neto.
--
-- Aplicar DESPUÉS de las migraciones 0001–0038. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tablas.
-- ---------------------------------------------------------------------------
create table if not exists public.prestamos (
  id                 uuid primary key default gen_random_uuid(),
  empleado_id        uuid not null references public.empleados(id) on delete restrict,
  monto              numeric not null check (monto > 0),
  fecha              date not null default (now() at time zone 'America/Bogota')::date,
  metodo_pago        text not null check (metodo_pago in ('efectivo','qr','transferencia')),
  concepto           text,
  caja_movimiento_id uuid references public.caja_movimientos(id) on delete set null,
  created_by         uuid not null references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now()
);

comment on table public.prestamos is
  'Préstamos de plata a los trabajadores. Cada uno sale como egreso de la caja principal.';

create index if not exists idx_prestamos_empleado on public.prestamos(empleado_id);

create table if not exists public.prestamo_abonos (
  id                 uuid primary key default gen_random_uuid(),
  prestamo_id        uuid not null references public.prestamos(id) on delete cascade,
  monto              numeric not null check (monto > 0),
  fecha              date not null default (now() at time zone 'America/Bogota')::date,
  -- Null cuando el abono se descontó de la nómina (no entra plata al cajón).
  metodo_pago        text check (metodo_pago in ('efectivo','qr','transferencia')),
  origen             text not null default 'manual' check (origen in ('manual','nomina')),
  liquidacion_id     uuid references public.nomina_liquidaciones(id) on delete set null,
  caja_movimiento_id uuid references public.caja_movimientos(id) on delete set null,
  created_by         uuid not null references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now()
);

comment on table public.prestamo_abonos is
  'Abonos a un préstamo. origen=manual entra como ingreso a la caja; origen=nomina se descuenta del pago de la liquidación.';

create index if not exists idx_abonos_prestamo on public.prestamo_abonos(prestamo_id);
create index if not exists idx_abonos_liquidacion on public.prestamo_abonos(liquidacion_id);

alter table public.prestamos       enable row level security;
alter table public.prestamo_abonos enable row level security;

-- Los préstamos son plata de la caja: solo admin y super_admin.
drop policy if exists prestamos_all on public.prestamos;
create policy prestamos_all on public.prestamos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists prestamo_abonos_all on public.prestamo_abonos;
create policy prestamo_abonos_all on public.prestamo_abonos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2) Saldos.
-- ---------------------------------------------------------------------------
create or replace function public.saldo_prestamo(p_prestamo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.monto, 0)
       - coalesce((select sum(a.monto) from public.prestamo_abonos a
                    where a.prestamo_id = p.id), 0)
    from public.prestamos p
   where p.id = p_prestamo_id;
$$;

create or replace function public.saldo_prestamos_empleado(p_empleado_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public.saldo_prestamo(p.id)), 0)
    from public.prestamos p
   where p.empleado_id = p_empleado_id;
$$;

comment on function public.saldo_prestamos_empleado(uuid) is
  'Cuánto debe en total un trabajador: préstamos menos abonos.';

grant execute on function public.saldo_prestamo(uuid) to authenticated;
grant execute on function public.saldo_prestamos_empleado(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Alta/edición/borrado de préstamos y abonos.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_prestamo(
  p_id          uuid,
  p_empleado_id uuid,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text,
  p_concepto    text default null
)
returns public.prestamos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_nombre    text;
  v_prestamo  public.prestamos;
  v_mov       public.caja_movimientos;
  v_mov_id    uuid;
  v_tiene_mov boolean := false;
  v_abonado   numeric;
  v_concepto  text;
  v_fecha     timestamptz;
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
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Elige con qué se entrega el préstamo';
  end if;

  select nombre into v_nombre from public.empleados where id = p_empleado_id;
  if not found then
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

  if v_prestamo.caja_movimiento_id is not null then
    select * into v_mov from public.caja_movimientos where id = v_prestamo.caja_movimiento_id;
    v_tiene_mov := found;
  end if;

  v_concepto := 'Préstamo: ' || v_nombre
             || coalesce(' — ' || nullif(btrim(p_concepto), ''), '');
  v_fecha := (p_fecha::timestamp at time zone 'America/Bogota');

  -- Si el egreso ya está dentro de un cierre, la plata de ese día está cuadrada.
  if v_tiene_mov and v_mov.cierre_id is not null then
    if p_monto <> v_mov.monto or p_metodo_pago is distinct from v_mov.metodo_pago then
      raise exception 'El egreso de este préstamo ya está en un cierre de caja: corrígelo desde Caja';
    end if;
    update public.caja_movimientos set concepto = v_concepto where id = v_mov.id;
    return v_prestamo;
  end if;

  if v_tiene_mov then
    update public.caja_movimientos
       set concepto    = v_concepto,
           metodo_pago = p_metodo_pago,
           monto       = p_monto,
           created_at  = v_fecha
     where id = v_mov.id;
  else
    insert into public.caja_movimientos
      (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
    values
      ('egreso', v_concepto, p_metodo_pago, p_monto, 'principal', v_fecha, false, v_uid)
    returning id into v_mov_id;

    update public.prestamos set caja_movimiento_id = v_mov_id
     where id = v_prestamo.id
    returning * into v_prestamo;
  end if;

  return v_prestamo;
end;
$$;

comment on function public.guardar_prestamo(uuid, uuid, numeric, date, text, text) is
  'Alta/edición de un préstamo a un trabajador + su egreso en la caja principal.';

grant execute on function public.guardar_prestamo(uuid, uuid, numeric, date, text, text) to authenticated;

create or replace function public.abonar_prestamo(
  p_prestamo_id uuid,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text
)
returns public.prestamo_abonos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_prestamo public.prestamos;
  v_nombre   text;
  v_saldo    numeric;
  v_mov_id   uuid;
  v_row      public.prestamo_abonos;
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
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Elige con qué se recibe el abono';
  end if;

  select * into v_prestamo from public.prestamos where id = p_prestamo_id for update;
  if not found then
    raise exception 'Préstamo no encontrado';
  end if;

  v_saldo := public.saldo_prestamo(p_prestamo_id);
  if p_monto > v_saldo then
    raise exception 'El abono supera el saldo pendiente (%)', v_saldo;
  end if;

  select nombre into v_nombre from public.empleados where id = v_prestamo.empleado_id;

  -- El abono entra como plata a la caja principal.
  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
  values
    ('ingreso', 'Abono préstamo: ' || coalesce(v_nombre, ''), p_metodo_pago, p_monto,
     'principal', (coalesce(p_fecha, (now() at time zone 'America/Bogota')::date)::timestamp
                   at time zone 'America/Bogota'), false, v_uid)
  returning id into v_mov_id;

  insert into public.prestamo_abonos
    (prestamo_id, monto, fecha, metodo_pago, origen, caja_movimiento_id, created_by)
  values
    (p_prestamo_id, p_monto, coalesce(p_fecha, (now() at time zone 'America/Bogota')::date),
     p_metodo_pago, 'manual', v_mov_id, v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.abonar_prestamo(uuid, numeric, date, text) is
  'Abono a un préstamo + su ingreso en la caja principal.';

grant execute on function public.abonar_prestamo(uuid, numeric, date, text) to authenticated;

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
  if v_row.origen = 'nomina' then
    raise exception 'Este abono se descontó en una liquidación de nómina: elimina esa liquidación';
  end if;

  -- El ingreso solo se borra si la caja de ese día sigue abierta.
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
  if exists (
    select 1 from public.prestamo_abonos where prestamo_id = p_id and origen = 'nomina'
  ) then
    raise exception 'Este préstamo tiene abonos descontados en nómina: elimina primero esas liquidaciones';
  end if;

  -- Los ingresos de los abonos manuales que sigan abiertos se van con ellos.
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
-- 4) Nómina: descuento del préstamo al liquidar.
-- ---------------------------------------------------------------------------
alter table public.nomina_liquidaciones
  add column if not exists abono_prestamo numeric not null default 0;

comment on column public.nomina_liquidaciones.abono_prestamo is
  'Cuánto se le descontó al trabajador de sus préstamos en esta liquidación. El egreso de caja es total_pagar − abono_prestamo.';

-- La firma cambia (agrega p_abono_prestamo): se elimina la anterior, si no
-- quedarían las dos y la llamada con 4 parámetros sería ambigua.
drop function if exists public.liquidar_nomina(uuid, date, date, text);

create or replace function public.liquidar_nomina(
  p_empleado_id    uuid,
  p_fecha_inicio   date,
  p_fecha_fin      date,
  p_metodo_pago    text default 'efectivo',
  p_abono_prestamo numeric default 0
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
  v_abono      numeric := coalesce(p_abono_prestamo, 0);
  v_pendiente  numeric;
  v_saldo      numeric;
  v_aplicar    numeric;
  v_prestamo   public.prestamos;
  v_neto       numeric;
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
  if v_abono < 0 then
    raise exception 'El descuento de préstamo no puede ser negativo';
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

  -- El descuento no puede pasarse ni de lo que debe ni de lo que se le paga.
  if v_abono > 0 then
    if v_abono > v_pagar then
      raise exception 'El descuento (%) es mayor que el pago de la liquidación (%)', v_abono, v_pagar;
    end if;
    if v_abono > public.saldo_prestamos_empleado(p_empleado_id) then
      raise exception 'El descuento es mayor que lo que % debe en préstamos', v_nombre;
    end if;
  end if;

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado,
     porcentaje, total_pagar, abono_prestamo)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado,
     v_porcentaje, v_pagar, v_abono)
  returning * into v_row;

  -- El descuento se reparte entre los préstamos del trabajador, del más viejo
  -- al más nuevo, hasta cubrirlo.
  v_pendiente := v_abono;
  if v_pendiente > 0 then
    for v_prestamo in
      select * from public.prestamos
       where empleado_id = p_empleado_id
       order by fecha, created_at
    loop
      exit when v_pendiente <= 0;
      v_saldo := public.saldo_prestamo(v_prestamo.id);
      if v_saldo > 0 then
        v_aplicar := least(v_saldo, v_pendiente);
        insert into public.prestamo_abonos
          (prestamo_id, monto, fecha, metodo_pago, origen, liquidacion_id, created_by)
        values
          (v_prestamo.id, v_aplicar, v_hoy, null, 'nomina', v_row.id, v_uid);
        v_pendiente := v_pendiente - v_aplicar;
      end if;
    end loop;
  end if;

  -- De la caja solo sale lo que de verdad se le entrega: el pago menos el abono.
  v_neto := v_pagar - v_abono;
  if v_neto > 0 then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
    values ('egreso',
            'Nómina: ' || v_nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
            p_metodo_pago, v_neto, 'principal', v_uid);
  end if;

  return v_row;
end;
$$;

comment on function public.liquidar_nomina(uuid, date, date, text, numeric) is
  'Liquida la comisión de un empleado. Puede descontar un abono de sus préstamos; el egreso de caja es el neto. Una vez por empleado y día.';

grant execute on function public.liquidar_nomina(uuid, date, date, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) eliminar_liquidacion: deshace también el abono descontado.
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

  -- Reconstruye el concepto EXACTO con que liquidar_nomina creó el egreso:
  -- 'Nómina: <nombre> (DD/MM–DD/MM)' y por el NETO (pago menos abono). Se borra
  -- solo si sigue abierto, para no romper un cierre ya cuadrado.
  select nombre into v_nombre from public.empleados where id = v_liq.empleado_id;
  v_concepto := 'Nómina: ' || coalesce(v_nombre, '') || ' ('
                || to_char(v_liq.fecha_inicio, 'DD/MM') || '–'
                || to_char(v_liq.fecha_fin, 'DD/MM') || ')';

  delete from public.caja_movimientos
   where cierre_id is null
     and orden_id is null
     and tipo = 'egreso'
     and concepto = v_concepto
     and monto = v_liq.total_pagar - coalesce(v_liq.abono_prestamo, 0);

  -- Lo que se le descontó de sus préstamos vuelve a quedar debiendo.
  delete from public.prestamo_abonos where liquidacion_id = p_id and origen = 'nomina';

  delete from public.nomina_liquidaciones where id = p_id;
end;
$$;

grant execute on function public.eliminar_liquidacion(uuid) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- Saldo de cada trabajador (debe estar vacío si aún no hay préstamos):
--   select e.nombre, public.saldo_prestamos_empleado(e.id) as debe
--     from public.empleados e
--    where public.saldo_prestamos_empleado(e.id) > 0;
--
--   -- La firma nueva de liquidar_nomina (5 parámetros):
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'liquidar_nomina';
-- ============================================================================
