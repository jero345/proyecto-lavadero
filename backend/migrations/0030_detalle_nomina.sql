-- ============================================================================
-- CAR WASH SERVICES — Migración 0030: Detalle de servicios de una liquidación
-- La liquidación solo guarda CUÁNTOS servicios hizo el empleado, no cuáles. El
-- negocio necesita poder abrir una liquidación y ver el detalle: qué órdenes
-- atendió y qué servicios le hizo a cada una.
--
-- `detalle_nomina` reconstruye ese detalle con el mismo criterio de
-- liquidar_nomina (mig. 0024): órdenes en las que el empleado tiene ítems, con
-- la fecha evaluada en hora de Colombia, una fila por orden.
-- Lo puede consultar cualquier usuario con sesión (la pantalla de Nómina está
-- abierta a todos los roles).
-- Idempotente.
-- ============================================================================

begin;

create or replace function public.detalle_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date
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
     group by o.id, o.created_at, o.placa, o.total
     order by o.created_at;
end;
$$;

comment on function public.detalle_nomina(uuid, date, date) is
  'Órdenes y servicios que atendió un empleado en un rango (detalle de una liquidación).';

grant execute on function public.detalle_nomina(uuid, date, date) to authenticated;

commit;
