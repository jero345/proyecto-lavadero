-- ============================================================================
-- CAR WASH SERVICES — Migración 0024: Borrar liquidaciones + orden = 1 servicio
-- Dos cambios pedidos por el negocio:
--   1) El STAFF (admin y super_admin) puede ELIMINAR una liquidación mal hecha.
--      Al borrarla, también se elimina su egreso de nómina en la caja principal
--      SIEMPRE que ese movimiento siga abierto (no incluido en un cierre de caja).
--      Si el egreso ya está cerrado, se conserva el movimiento (no se toca el
--      cuadre) pero la liquidación sí se elimina de la lista.
--   2) Al liquidar, una ORDEN COMPLETA cuenta como 1 servicio (antes contaba
--      cada ítem/servicio de la orden por separado). El facturado no cambia:
--      sigue siendo el total real de cada orden, una vez por orden.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) eliminar_liquidacion: borra una liquidación (solo admin/super_admin) y su
--    egreso de nómina asociado si aún está abierto.
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

  -- Reconstruye el concepto EXACTO con que liquidar_nomina creó el egreso
  -- (mig. 0022): 'Nómina: <nombre> (DD/MM–DD/MM)'. Se borra ese egreso solo si
  -- sigue abierto (cierre_id null) para no romper un cierre de caja ya cuadrado.
  select nombre into v_nombre from public.empleados where id = v_liq.empleado_id;
  v_concepto := 'Nómina: ' || coalesce(v_nombre, '') || ' ('
                || to_char(v_liq.fecha_inicio, 'DD/MM') || '–'
                || to_char(v_liq.fecha_fin, 'DD/MM') || ')';

  delete from public.caja_movimientos
   where cierre_id is null
     and orden_id is null
     and tipo = 'egreso'
     and concepto = v_concepto
     and monto = v_liq.total_pagar;

  delete from public.nomina_liquidaciones where id = p_id;
end;
$$;

grant execute on function public.eliminar_liquidacion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) liquidar_nomina: una orden completa cuenta como 1 servicio.
--    - Servicios = # de ÓRDENES del empleado en el rango (antes: # de ítems).
--    - Facturado = suma de ordenes.total (UNA vez por orden). Sin cambios.
--    Mantiene el egreso en la caja principal (mig. 0016).
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

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

commit;
