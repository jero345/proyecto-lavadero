-- ============================================================================
-- CAR WASH SERVICES — BORRAR DATOS ANTERIORES A UNA FECHA (¡IRREVERSIBLE!)
-- Configurado para dejar SOLO del 30 de julio de 2026 en adelante.
-- El corte es a las 00:00 hora Colombia del día indicado: se borra todo lo
-- ANTERIOR y se conserva ese día completo.
--
--  BORRA (lo anterior al corte):
--    · caja_movimientos       (ingresos de órdenes, egresos manuales y de nómina)
--    · ordenes + orden_items  (los ítems caen en cascada)
--    · cierres_caja           (los cerrados antes del corte)
--    · nomina_liquidaciones
--    · ventas_productos
--    · inventario_movimientos (el historial; el stock NO se recalcula)
--
--  CONSERVA:
--    · clientes, vehículos, empleados, servicios, productos, tipos de vehículo
--    · usuarios / profiles / Auth
--    · productos.stock_actual  ← la existencia física de hoy sigue siendo la real
--    · gastos_fijos            ← tabla nueva (mig. 0027), no hay nada tan viejo
--
--  ⚠️  CIERRES QUE CRUZAN EL CORTE: un cierre hecho DESPUÉS del 30 pudo
--      consolidar movimientos de ANTES. Ese cierre se conserva con sus totales
--      originales, pero sus movimientos viejos ya no existirán (el detalle no
--      cuadrará con el total). El PASO 1 los lista para que decidas.
--  ⚠️  HAZ UN BACKUP ANTES: Supabase → Database → Backups.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PASO 1 (opcional) — Ver cuánto se va a borrar ANTES de hacerlo.
-- Descomenta y ejecuta solo este bloque.
-- ---------------------------------------------------------------------------
-- with corte as (select (date '2026-07-30')::timestamp at time zone 'America/Bogota' as t)
-- select 'ordenes'                as tabla, count(*) from public.ordenes,                corte where created_at   < corte.t
-- union all select 'orden_items',            count(*) from public.orden_items oi         where exists (select 1 from public.ordenes o, corte where o.id = oi.orden_id and o.created_at < corte.t)
-- union all select 'caja_movimientos',       count(*) from public.caja_movimientos,      corte where created_at   < corte.t
-- union all select 'cierres_caja',           count(*) from public.cierres_caja,          corte where fecha_cierre < corte.t
-- union all select 'nomina_liquidaciones',   count(*) from public.nomina_liquidaciones,  corte where created_at   < corte.t
-- union all select 'ventas_productos',       count(*) from public.ventas_productos,      corte where created_at   < corte.t
-- union all select 'inventario_movimientos', count(*) from public.inventario_movimientos,corte where created_at   < corte.t
-- union all select 'cierres que cruzan el corte (se conservan)',
--                                            count(*) from public.cierres_caja c, corte
--                                             where c.fecha_cierre >= corte.t and c.fecha_apertura < corte.t;

-- ---------------------------------------------------------------------------
-- PASO 2 — Borrado. Cambia la fecha en `v_corte` si necesitas otro día.
-- ---------------------------------------------------------------------------
do $$
declare
  v_corte timestamptz := (date '2026-07-30')::timestamp at time zone 'America/Bogota';
  v_mov   int;
  v_ord   int;
  v_cie   int;
  v_nom   int;
  v_ven   int;
  v_inv   int;
  v_cruza int;
begin
  select count(*) into v_cruza
    from public.cierres_caja
   where fecha_cierre >= v_corte and fecha_apertura < v_corte;

  -- 1) Caja: ingresos de órdenes, egresos manuales y egresos de nómina.
  delete from public.caja_movimientos where created_at < v_corte;
  get diagnostics v_mov = row_count;

  -- 2) Órdenes (orden_items cae en cascada).
  delete from public.ordenes where created_at < v_corte;
  get diagnostics v_ord = row_count;

  -- 3) Cierres de caja cerrados antes del corte.
  delete from public.cierres_caja where fecha_cierre < v_corte;
  get diagnostics v_cie = row_count;

  -- 4) Nómina.
  delete from public.nomina_liquidaciones where created_at < v_corte;
  get diagnostics v_nom = row_count;

  -- 5) Inventario: ventas e historial de stock. `productos.stock_actual` NO se
  --    toca a propósito: la existencia física de hoy ya es la correcta.
  delete from public.ventas_productos where created_at < v_corte;
  get diagnostics v_ven = row_count;

  delete from public.inventario_movimientos where created_at < v_corte;
  get diagnostics v_inv = row_count;

  raise notice 'Corte: % (hora Colombia). Borrado:', v_corte;
  raise notice '  · movimientos de caja: %', v_mov;
  raise notice '  · órdenes (con sus ítems): %', v_ord;
  raise notice '  · cierres de caja: %', v_cie;
  raise notice '  · liquidaciones de nómina: %', v_nom;
  raise notice '  · ventas de inventario: %', v_ven;
  raise notice '  · movimientos de inventario: %', v_inv;
  if v_cruza > 0 then
    raise notice '  ⚠ % cierre(s) abarcan ambos lados del corte: se conservan con', v_cruza;
    raise notice '    sus totales originales, pero ya no tienen todos sus movimientos.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3 — Verificación: qué quedó y desde cuándo.
-- ---------------------------------------------------------------------------
select 'ordenes'                as tabla, count(*) as filas, min(created_at)::text   as mas_antiguo from public.ordenes
union all select 'caja_movimientos',      count(*),          min(created_at)::text                 from public.caja_movimientos
union all select 'cierres_caja',          count(*),          min(fecha_cierre)::text               from public.cierres_caja
union all select 'nomina_liquidaciones',  count(*),          min(created_at)::text                 from public.nomina_liquidaciones
union all select 'ventas_productos',      count(*),          min(created_at)::text                 from public.ventas_productos
union all select 'inventario_movimientos',count(*),          min(created_at)::text                 from public.inventario_movimientos;
