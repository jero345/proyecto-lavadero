-- ============================================================================
-- CAR WASH SERVICES — Migración 0021: Tipos de vehículo dinámicos
-- Antes los tipos de vehículo eran 4 fijos (CHECK). Ahora son un catálogo que
-- el staff puede ampliar (Buseta, Camión, etc.).
--   1) Tabla `tipos_vehiculo` (+ RLS: todos leen, staff edita) sembrada con los 4.
--   2) Se quitan los CHECK que fijaban los 4 en servicios/vehiculos.
--   3) FK servicios.tipo_vehiculo -> tipos_vehiculo(codigo) (no borrar un tipo en uso).
--   4) servicios: ahora lo edita cualquier STAFF (admin o super_admin), no solo super.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Catálogo de tipos de vehículo.
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_vehiculo (
  codigo     text primary key,
  nombre     text not null,
  orden      int not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.tipos_vehiculo is
  'Catálogo de tipos de vehículo (dinámico). codigo = slug usado en servicios.tipo_vehiculo.';

grant select, insert, update, delete on public.tipos_vehiculo to authenticated;
alter table public.tipos_vehiculo enable row level security;

drop policy if exists tipos_vehiculo_select on public.tipos_vehiculo;
create policy tipos_vehiculo_select on public.tipos_vehiculo for select to authenticated
  using (true);

drop policy if exists tipos_vehiculo_write on public.tipos_vehiculo;
create policy tipos_vehiculo_write on public.tipos_vehiculo for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Semilla: los 4 tipos actuales (conserva los codigos ya usados en servicios).
insert into public.tipos_vehiculo (codigo, nombre, orden) values
  ('moto',      'Moto',                  1),
  ('moto_alto', 'Moto alto cilindraje',  2),
  ('auto',      'Auto',                  3),
  ('camioneta', 'Camioneta',             4)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Quitar los CHECK que fijaban los 4 tipos (para permitir nuevos).
--    (Busca el nombre real del constraint sin asumirlo.)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid in ('public.servicios'::regclass, 'public.vehiculos'::regclass)
      and pg_get_constraintdef(con.oid) ilike '%moto%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) FK: el tipo de un servicio debe existir en el catálogo.
-- ---------------------------------------------------------------------------
alter table public.servicios
  drop constraint if exists servicios_tipo_vehiculo_fkey;
alter table public.servicios
  add constraint servicios_tipo_vehiculo_fkey
  foreign key (tipo_vehiculo) references public.tipos_vehiculo(codigo) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4) servicios: ahora lo edita cualquier staff (admin o super_admin).
-- ---------------------------------------------------------------------------
drop policy if exists servicios_write on public.servicios;
create policy servicios_write on public.servicios for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

commit;
