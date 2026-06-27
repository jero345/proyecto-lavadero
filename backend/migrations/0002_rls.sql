-- ============================================================================
-- CAR WASH SERVICES — Migración 0002: RLS + get_rol() + trigger + realtime
-- Fase 3 del plan. Pegar en SQL Editor -> Run.
-- Reglas:
--   super_admin / admin: leen/escriben lo operativo.
--   empleado: INSERT en ordenes/orden_items; SELECT solo de las suyas;
--             SIN acceso a caja, cierres ni nómina ajena.
--   Solo super_admin gestiona profiles (usuarios) y edita servicios.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER para leer profiles sin disparar RLS (evita recursión).
-- ---------------------------------------------------------------------------
create or replace function public.get_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid();
$$;
comment on function public.get_rol() is 'Rol del usuario autenticado (lee profiles sin RLS).';

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_rol() in ('admin','super_admin'), false);
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_rol() = 'super_admin', false);
$$;

grant execute on function public.get_rol(), public.is_staff(), public.is_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: crear automáticamente el profile (rol empleado) al crear un usuario.
-- Permite dar de alta empleados desde Supabase -> Authentication -> Add user.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre',''), split_part(new.email,'@',1)),
    'empleado'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privilegios base (RLS gobierna las filas; los GRANT habilitan el acceso API).
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ===========================================================================
-- POLÍTICAS
-- ===========================================================================

-- ----- profiles ------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_super_admin());

-- ----- clientes (todos los autenticados leen/crean; staff edita/borra) ------
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated using (true);

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes for insert to authenticated with check (true);

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes for delete to authenticated
  using (public.is_staff());

-- ----- vehiculos -----------------------------------------------------------
drop policy if exists vehiculos_select on public.vehiculos;
create policy vehiculos_select on public.vehiculos for select to authenticated using (true);

drop policy if exists vehiculos_insert on public.vehiculos;
create policy vehiculos_insert on public.vehiculos for insert to authenticated with check (true);

drop policy if exists vehiculos_update on public.vehiculos;
create policy vehiculos_update on public.vehiculos for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists vehiculos_delete on public.vehiculos;
create policy vehiculos_delete on public.vehiculos for delete to authenticated
  using (public.is_staff());

-- ----- servicios (catálogo: todos leen; SOLO super_admin edita) ------------
drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios for select to authenticated using (true);

drop policy if exists servicios_write on public.servicios;
create policy servicios_write on public.servicios for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ----- ordenes -------------------------------------------------------------
drop policy if exists ordenes_select on public.ordenes;
create policy ordenes_select on public.ordenes for select to authenticated
  using (
    public.is_staff()
    or created_by = auth.uid()
    or exists (
      select 1 from public.orden_items oi
      where oi.orden_id = ordenes.id and oi.empleado_id = auth.uid()
    )
  );

drop policy if exists ordenes_insert on public.ordenes;
create policy ordenes_insert on public.ordenes for insert to authenticated
  with check (created_by = auth.uid() or public.is_staff());

-- UPDATE directo solo para staff (evita que el empleado altere total/metodo_pago
-- por REST y descuadre la caja). El empleado avanza el estado vía la función
-- avanzar_estado_orden (SECURITY DEFINER), que solo toca la columna estado.
drop policy if exists ordenes_update on public.ordenes;
create policy ordenes_update on public.ordenes for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists ordenes_delete on public.ordenes;
create policy ordenes_delete on public.ordenes for delete to authenticated
  using (public.is_staff());

-- ----- orden_items ---------------------------------------------------------
drop policy if exists orden_items_select on public.orden_items;
create policy orden_items_select on public.orden_items for select to authenticated
  using (
    public.is_staff()
    or empleado_id = auth.uid()
    or exists (
      select 1 from public.ordenes o
      where o.id = orden_items.orden_id and o.created_by = auth.uid()
    )
  );

-- El empleado NO inserta items directo por REST (evita precio/empleado_id falsos);
-- sus órdenes se crean vía la función crear_orden (SECURITY DEFINER).
drop policy if exists orden_items_insert on public.orden_items;
create policy orden_items_insert on public.orden_items for insert to authenticated
  with check (public.is_staff());

drop policy if exists orden_items_update on public.orden_items;
create policy orden_items_update on public.orden_items for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists orden_items_delete on public.orden_items;
create policy orden_items_delete on public.orden_items for delete to authenticated
  using (public.is_staff());

-- ----- caja_movimientos (SOLO staff; empleado sin acceso) ------------------
drop policy if exists caja_all on public.caja_movimientos;
create policy caja_all on public.caja_movimientos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ----- cierres_caja (SOLO staff) -------------------------------------------
drop policy if exists cierres_all on public.cierres_caja;
create policy cierres_all on public.cierres_caja for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ----- productos (SOLO staff) ----------------------------------------------
drop policy if exists productos_all on public.productos;
create policy productos_all on public.productos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ----- inventario_movimientos (SOLO staff) ---------------------------------
drop policy if exists inv_mov_all on public.inventario_movimientos;
create policy inv_mov_all on public.inventario_movimientos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ----- nomina_liquidaciones (staff todo; empleado solo lo suyo en lectura) --
drop policy if exists nomina_select on public.nomina_liquidaciones;
create policy nomina_select on public.nomina_liquidaciones for select to authenticated
  using (public.is_staff() or empleado_id = auth.uid());

drop policy if exists nomina_write on public.nomina_liquidaciones;
create policy nomina_write on public.nomina_liquidaciones for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Realtime: el Dashboard escucha cambios de ordenes (vehículos en proceso).
-- RLS sigue aplicando a los eventos realtime.
-- ---------------------------------------------------------------------------
alter table public.ordenes replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ordenes'
  ) then
    alter publication supabase_realtime add table public.ordenes;
  end if;
end $$;

commit;
