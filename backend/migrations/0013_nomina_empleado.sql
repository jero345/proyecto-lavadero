-- ============================================================================
-- CAR WASH SERVICES — Migración 0013: Nómina también para el operador
-- Abre Nómina a cualquier usuario con sesión (antes solo staff): liquidar y ver
-- las liquidaciones. Caja y gestión de empleados(roster) siguen solo-staff.
-- Idempotente.
-- ============================================================================

begin;

-- ----- RLS de nomina_liquidaciones: todos los autenticados leen/escriben ----
drop policy if exists nomina_select on public.nomina_liquidaciones;
create policy nomina_select on public.nomina_liquidaciones for select to authenticated
  using (true);

drop policy if exists nomina_write on public.nomina_liquidaciones;
create policy nomina_write on public.nomina_liquidaciones for all to authenticated
  using (true) with check (true);

-- ----- liquidar_nomina: se quita el requisito de is_staff --------------------
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
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;

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
