-- ============================================================================
-- CAR WASH SERVICES — BORRAR UN EMPLEADO (¡DESTRUCTIVO E IRREVERSIBLE!)
-- El botón de la app no puede eliminar a un empleado que ya tiene órdenes o
-- nómina (la FK lo impide, a propósito, para no perder historial). Este script
-- sí lo elimina, dejando la contabilidad coherente.
--
--  QUÉ HACE (en una sola transacción):
--    1) Desasigna sus órdenes: `orden_items.empleado_id` queda en NULL. Las
--       órdenes, sus totales y los ingresos de caja NO se tocan; simplemente
--       quedan "sin asignar" (se les puede poner otro empleado desde Órdenes).
--    2) Borra sus liquidaciones de nómina y, de cada una, el egreso
--       "Nómina: <nombre> (DD/MM–DD/MM)" de la caja principal SOLO si sigue
--       abierto. Si ese egreso ya entró en un cierre de caja, se conserva para
--       no descuadrar el cierre (igual que hace `eliminar_liquidacion`).
--    3) Borra el empleado.
--
--  ALTERNATIVA SIN BORRAR: si solo quieres que no aparezca al crear órdenes,
--  desactívalo desde la app (Empleados → lápiz → desmarcar "Empleado activo").
--  Conserva todo el historial y es reversible.
--
--  ⚠️  HAZ UN BACKUP ANTES: Supabase → Database → Backups.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PASO 1 (opcional) — Ver qué se va a tocar ANTES de borrar.
-- Descomenta este bloque, cambia el nombre y ejecútalo solo.
-- ---------------------------------------------------------------------------
-- select e.id,
--        e.nombre,
--        e.activo,
--        (select count(*) from public.orden_items oi where oi.empleado_id = e.id)          as items_de_ordenes,
--        (select count(*) from public.nomina_liquidaciones n where n.empleado_id = e.id)   as liquidaciones
--   from public.empleados e
--  where lower(btrim(e.nombre)) = lower(btrim('Arturo'));

-- ---------------------------------------------------------------------------
-- PASO 2 — Borrado. Cambia el nombre en `v_nombre` (debe ser exacto, aunque no
-- distingue mayúsculas ni espacios sobrantes). Si hay dos empleados con el
-- mismo nombre, el script se detiene: en ese caso usa el id (ver más abajo).
-- ---------------------------------------------------------------------------
do $$
declare
  v_nombre   text := 'Arturo';   -- <<< NOMBRE DEL EMPLEADO A BORRAR
  v_id       uuid;
  v_real     text;   -- nombre tal cual está guardado (para armar el concepto)
  v_cuantos  int;
  v_items    int;
  v_liqs     int;
  v_egresos  int := 0;
  v_n        int;
  r          record;
  v_concepto text;
begin
  select count(*) into v_cuantos
    from public.empleados
   where lower(btrim(nombre)) = lower(btrim(v_nombre));

  if v_cuantos = 0 then
    raise exception 'No existe ningún empleado llamado "%"', v_nombre;
  elsif v_cuantos > 1 then
    raise exception 'Hay % empleados llamados "%": bórralo por id (cambia el where por id = ''…'')',
      v_cuantos, v_nombre;
  end if;

  select id, nombre into v_id, v_real
    from public.empleados
   where lower(btrim(nombre)) = lower(btrim(v_nombre));

  -- 1) Órdenes: se conservan, quedan sin empleado asignado.
  update public.orden_items
     set empleado_id = null
   where empleado_id = v_id;
  get diagnostics v_items = row_count;

  -- 2) Nómina: por cada liquidación, borra su egreso de caja si sigue abierto.
  --    El concepto se reconstruye igual que en liquidar_nomina (mig. 0022/0024).
  for r in
    select * from public.nomina_liquidaciones where empleado_id = v_id
  loop
    v_concepto := 'Nómina: ' || v_real || ' ('
               || to_char(r.fecha_inicio, 'DD/MM') || '–'
               || to_char(r.fecha_fin,    'DD/MM') || ')';

    delete from public.caja_movimientos
     where cierre_id is null
       and orden_id is null
       and tipo = 'egreso'
       and monto = r.total_pagar
       and concepto = v_concepto;
    get diagnostics v_n = row_count;
    v_egresos := v_egresos + v_n;
  end loop;

  delete from public.nomina_liquidaciones where empleado_id = v_id;
  get diagnostics v_liqs = row_count;

  -- 3) El empleado.
  delete from public.empleados where id = v_id;

  raise notice 'Empleado "%" (%) eliminado.', v_real, v_id;
  raise notice '  · ítems de órdenes desasignados: %', v_items;
  raise notice '  · liquidaciones de nómina borradas: %', v_liqs;
  raise notice '  · egresos de nómina abiertos borrados de la caja: %', v_egresos;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3 — Verificación: lista los empleados que quedan.
-- ---------------------------------------------------------------------------
select id, nombre, telefono, porcentaje_comision, activo, created_at
  from public.empleados
 order by nombre;
