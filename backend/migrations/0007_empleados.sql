-- ============================================================================
-- CAR WASH SERVICES — Migración 0007: Empleados como roster (sin login)
-- Antes los "empleados" eran usuarios del sistema (profiles + auth). Ahora son
-- un catálogo de trabajadores que NO entran al sistema, solo se asignan a las
-- órdenes y cobran comisión (nómina).
--
--   - Nueva tabla `empleados` (+ RLS).
--   - Migra los profiles ya referenciados en órdenes/nómina al nuevo roster
--     (conservando el mismo id, para no romper datos existentes).
--   - orden_items.empleado_id y nomina_liquidaciones.empleado_id -> empleados.
--   - crear_orden / liquidar_nomina leen la comisión desde `empleados`.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tabla empleados (roster de trabajadores, sin cuenta de acceso).
-- ---------------------------------------------------------------------------
create table if not exists public.empleados (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  telefono            text,
  porcentaje_comision numeric not null default 40
                        check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);
comment on table public.empleados is
  'Trabajadores asignables a órdenes (comisión/nómina). NO son usuarios del sistema.';
create index if not exists idx_empleados_activo on public.empleados(activo);

-- Permisos de API para la tabla nueva (el grant masivo de 0002 no la cubre).
grant select, insert, update, delete on public.empleados to authenticated;

alter table public.empleados enable row level security;

-- Todos los autenticados leen el roster (para el selector del POS / nómina);
-- solo staff lo administra.
drop policy if exists empleados_select on public.empleados;
create policy empleados_select on public.empleados for select to authenticated
  using (true);

drop policy if exists empleados_write on public.empleados;
create policy empleados_write on public.empleados for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2) Migra los profiles que YA están referenciados en órdenes/nómina al roster.
--    Conserva el mismo id => los empleado_id existentes siguen siendo válidos.
-- ---------------------------------------------------------------------------
insert into public.empleados (id, nombre, telefono, porcentaje_comision, activo, created_at)
select p.id, p.nombre, null, p.porcentaje_comision, p.activo, p.created_at
from public.profiles p
where p.id in (
  select empleado_id from public.orden_items
  union
  select empleado_id from public.nomina_liquidaciones
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Reapunta las FKs de empleado_id: profiles -> empleados.
--    (DO block: encuentra el nombre real de la FK sin asumirlo.)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.conrelid in ('public.orden_items'::regclass,
                         'public.nomina_liquidaciones'::regclass)
      and c.conkey = array[
        (select attnum from pg_attribute
          where attrelid = c.conrelid and attname = 'empleado_id')
      ]
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.orden_items
  add constraint orden_items_empleado_id_fkey
  foreign key (empleado_id) references public.empleados(id) on delete restrict;

alter table public.nomina_liquidaciones
  add constraint nomina_liquidaciones_empleado_id_fkey
  foreign key (empleado_id) references public.empleados(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4) crear_orden: la comisión sale de `empleados`. Ya no auto-asigna al usuario
--    (los empleados no inician sesión: quien crea la orden elige al trabajador).
--    Conserva el método de pago OPCIONAL (orden agendada) de la 0005.
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

  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is not null
     and p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  if p_empleado_id is null then
    raise exception 'Debe asignar un empleado';
  end if;

  -- % de comisión del trabajador (debe existir y estar activo) — desde el roster.
  select porcentaje_comision into v_comision
  from public.empleados where id = p_empleado_id and activo = true;
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

  insert into public.ordenes (cliente_id, vehiculo_id, placa, estado, metodo_pago, total, foto_url, created_by)
  values (p_cliente_id, p_vehiculo_id, p_placa, 'en_proceso', p_metodo_pago, v_total, p_foto_url, v_uid)
  returning id into v_orden_id;

  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  select v_orden_id, s.id, p_empleado_id, s.precio, v_comision
  from public.servicios s
  where s.id = any(p_servicio_ids) and s.activo = true;

  -- Ingreso a caja SOLO si ya se cobró (hay método de pago).
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
-- 5) liquidar_nomina: la comisión sale de `empleados`.
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

  -- El empleado debe existir en el roster (se permite liquidar inactivos).
  select porcentaje_comision into v_porcentaje
  from public.empleados where id = p_empleado_id;
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

commit;
