-- ============================================================================
-- CAR WASH SERVICES — Migración 0044: trabajadores con SALARIO FIJO.
--
-- Hasta acá todos los trabajadores ganaban comisión (% de lo que lavan). Ahora
-- hay trabajadores a los que se les paga el salario mínimo legal (Diego): no
-- ganan comisión, cobran un fijo por quincena y van en la nómina aparte.
--
--   1) empleados: `tipo_pago` ('comision' | 'salario'), `salario_mensual` y
--      `auxilio_transporte`.
--   2) nomina_liquidaciones: `tipo` para distinguir pago de salario y comisión.
--   3) liquidar_salario(): paga una quincena = (salario + auxilio) / 2, egreso
--      en la caja principal. No deja pagar dos veces la misma quincena.
--   4) liquidar_nomina(): rechaza a los de salario fijo (no ganan comisión).
--   5) empleados_pendientes_liquidar(): ya no avisa por los de salario fijo.
--   6) Diego queda con el SMMLV 2026 ($1.750.905) + auxilio ($249.095).
--
-- El concepto del egreso es el mismo de la nómina ('Nómina: X (DD/MM–DD/MM)'),
-- así `eliminar_liquidacion` lo sigue encontrando y borrando sin cambios.
--
-- Aplicar DESPUÉS de las migraciones 0001–0043. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tipo de pago del trabajador.
-- ---------------------------------------------------------------------------
alter table public.empleados
  add column if not exists tipo_pago text not null default 'comision',
  add column if not exists salario_mensual numeric not null default 0,
  add column if not exists auxilio_transporte numeric not null default 0;

alter table public.empleados drop constraint if exists empleados_tipo_pago_check;
alter table public.empleados add constraint empleados_tipo_pago_check
  check (tipo_pago in ('comision', 'salario'));

alter table public.empleados drop constraint if exists empleados_salario_check;
alter table public.empleados add constraint empleados_salario_check
  check (salario_mensual >= 0 and auxilio_transporte >= 0
         and (tipo_pago = 'comision' or salario_mensual > 0));

comment on column public.empleados.tipo_pago is
  'comision = gana % de lo que lava · salario = sueldo fijo por quincena (sin comisión).';

-- ---------------------------------------------------------------------------
-- 2) Qué se pagó en cada liquidación.
-- ---------------------------------------------------------------------------
alter table public.nomina_liquidaciones
  add column if not exists tipo text not null default 'comision';

alter table public.nomina_liquidaciones drop constraint if exists nomina_liquidaciones_tipo_check;
alter table public.nomina_liquidaciones add constraint nomina_liquidaciones_tipo_check
  check (tipo in ('comision', 'salario'));

-- ---------------------------------------------------------------------------
-- 3) liquidar_salario: paga una quincena del sueldo fijo.
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_salario(
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

  v_pagar := round((v_emp.salario_mensual + v_emp.auxilio_transporte) / 2.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado,
     porcentaje, total_pagar, tipo)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, 0, 0, 0, v_pagar, 'salario')
  returning * into v_row;

  -- Mismo concepto que la nómina: eliminar_liquidacion lo reconoce.
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
  values ('egreso',
          'Nómina: ' || v_emp.nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
          p_metodo_pago, v_pagar, 'principal', v_uid);

  return v_row;
end;
$$;

comment on function public.liquidar_salario(uuid, date, date, text) is
  'Paga una quincena (salario + auxilio) / 2 a un trabajador de salario fijo + egreso en caja. Una vez por quincena.';

grant execute on function public.liquidar_salario(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) liquidar_nomina: igual a la 0042, pero los de salario fijo no van acá.
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
  v_tipo_pago  text;
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

  select nombre, porcentaje_comision, tipo_pago into v_nombre, v_porcentaje, v_tipo_pago
  from public.empleados where id = p_empleado_id;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;
  if v_tipo_pago = 'salario' then
    raise exception '% tiene salario fijo: se paga en la nómina de salario, no por comisión.', v_nombre;
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
  'Liquida la comisión de un empleado + egreso en caja por el total. Una vez por empleado y día. No aplica a salario fijo (mig. 0044).';

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) empleados_pendientes_liquidar: igual a la 0032, sin los de salario fijo
--    (a ellos no se les liquida a diario, se les paga por quincena).
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
       and e.tipo_pago = 'comision'
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
  'Trabajadores por comisión con órdenes de hoy que aún no tienen liquidación de hoy (aviso "falta liquidar").';

grant execute on function public.empleados_pendientes_liquidar() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Diego: salario mínimo 2026 + auxilio de transporte. Si no está en el
--    roster, se crea.
-- ---------------------------------------------------------------------------
update public.empleados
   set tipo_pago          = 'salario',
       salario_mensual    = 1750905,
       auxilio_transporte = 249095
 where lower(btrim(nombre)) like 'diego%';

insert into public.empleados (nombre, tipo_pago, salario_mensual, auxilio_transporte)
select 'Diego', 'salario', 1750905, 249095
 where not exists (
   select 1 from public.empleados where lower(btrim(nombre)) like 'diego%'
 );

commit;
