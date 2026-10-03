-- ============================================================================
-- CAR WASH SERVICES — DEJAR SOLO LO DE OCTUBRE DE 2026 (¡IRREVERSIBLE!)
--
-- Borra todo el movimiento de dinero y de trabajo ANTERIOR al 1 de octubre de
-- 2026 (00:00 hora Colombia): septiembre y lo que haya más atrás.
--
--  BORRA:
--    · ordenes + orden_items   (los ítems caen en cascada)
--    · caja_movimientos        (cobros, egresos, nómina, gastos, ventas)
--    · cierres_caja            (los cerrados antes del corte)
--    · nomina_liquidaciones
--    · gastos_fijos            (los pagos de antes del corte)
--    · ventas_productos + inventario_movimientos (el historial de stock)
--    · prestamos YA PAGADOS de antes del corte (con sus abonos)
--
--  CONSERVA:
--    · clientes, vehículos, empleados, servicios, productos, tipos de vehículo
--    · usuarios / profiles / Auth
--    · productos.stock_actual  ← la existencia física de hoy sigue siendo la real
--    · PRÉSTAMOS CON SALDO: aunque sean de septiembre, si el trabajador todavía
--      debe, el préstamo se queda (si no, se le perdonaría la deuda sin querer).
--      Su egreso de caja sí se borra, así que queda sin movimiento asociado.
--
--  ⚠️  CIERRES QUE CRUZAN EL CORTE: un cierre hecho en octubre pudo consolidar
--      movimientos de septiembre. Ese cierre se conserva con sus totales
--      originales, pero ya no tendrá todos sus movimientos (el detalle no
--      cuadrará con el total). El PASO 1 los cuenta.
--  ⚠️  HAZ UN BACKUP ANTES: Supabase → Database → Backups.
--
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PASO 1 (recomendado) — Ver cuánto se va a borrar ANTES de hacerlo.
-- Selecciona SOLO este bloque (quitándole los guiones) y dale Run.
-- ---------------------------------------------------------------------------
-- with corte as (select (date '2026-10-01')::timestamp at time zone 'America/Bogota' as t,
--                       date '2026-10-01' as d)
-- select 'ordenes'                as tabla, count(*) from public.ordenes,                 corte where created_at   < corte.t
-- union all select 'caja_movimientos',       count(*) from public.caja_movimientos,       corte where created_at   < corte.t
-- union all select 'cierres_caja',           count(*) from public.cierres_caja,           corte where fecha_cierre < corte.t
-- union all select 'nomina_liquidaciones',   count(*) from public.nomina_liquidaciones,   corte where created_at   < corte.t
-- union all select 'gastos_fijos',           count(*) from public.gastos_fijos,           corte where fecha        < corte.d
-- union all select 'ventas_productos',       count(*) from public.ventas_productos,       corte where created_at   < corte.t
-- union all select 'inventario_movimientos', count(*) from public.inventario_movimientos, corte where created_at   < corte.t
-- union all select 'préstamos pagados (se borran)',
--                  count(*) from public.prestamos p, corte
--                   where p.fecha < corte.d and public.saldo_prestamo(p.id) <= 0
-- union all select 'préstamos con saldo (SE CONSERVAN)',
--                  count(*) from public.prestamos p, corte
--                   where p.fecha < corte.d and public.saldo_prestamo(p.id) > 0
-- union all select 'cierres que cruzan el corte (se conservan)',
--                  count(*) from public.cierres_caja c, corte
--                   where c.fecha_cierre >= corte.t and c.fecha_apertura < corte.t;

-- ---------------------------------------------------------------------------
-- PASO 2 — El borrado. Cambia la fecha de `v_corte_dia` si necesitas otro corte.
-- ---------------------------------------------------------------------------
do $$
declare
  v_corte_dia date        := date '2026-10-01';
  v_corte     timestamptz := v_corte_dia::timestamp at time zone 'America/Bogota';
  v_mov   int := 0;
  v_ord   int := 0;
  v_cie   int := 0;
  v_nom   int := 0;
  v_gas   int := 0;
  v_ven   int := 0;
  v_inv   int := 0;
  v_pre   int := 0;
  v_deuda int := 0;
  v_cruza int;
begin
  select count(*) into v_cruza
    from public.cierres_caja
   where fecha_cierre >= v_corte and fecha_apertura < v_corte;

  -- 1) Préstamos viejos YA PAGADOS (sus abonos caen en cascada). Los que aún
  --    tienen saldo se quedan: esa deuda sigue viva.
  if to_regclass('public.prestamos') is not null then
    execute 'delete from public.prestamos p
              where p.fecha < $1 and public.saldo_prestamo(p.id) <= 0'
       using v_corte_dia;
    get diagnostics v_pre = row_count;

    execute 'select count(*) from public.prestamos p
              where p.fecha < $1 and public.saldo_prestamo(p.id) > 0'
       into v_deuda using v_corte_dia;
  end if;

  -- 2) Gastos fijos del periodo (su egreso se va en el paso siguiente).
  delete from public.gastos_fijos where fecha < v_corte_dia;
  get diagnostics v_gas = row_count;

  -- 3) Caja: cobros de órdenes, egresos manuales, nómina, gastos y ventas.
  delete from public.caja_movimientos where created_at < v_corte;
  get diagnostics v_mov = row_count;

  -- 4) Órdenes (orden_items cae en cascada).
  delete from public.ordenes where created_at < v_corte;
  get diagnostics v_ord = row_count;

  -- 5) Cierres de caja cerrados antes del corte.
  delete from public.cierres_caja where fecha_cierre < v_corte;
  get diagnostics v_cie = row_count;

  -- 6) Nómina.
  delete from public.nomina_liquidaciones where created_at < v_corte;
  get diagnostics v_nom = row_count;

  -- 7) Inventario: ventas e historial de stock. `productos.stock_actual` NO se
  --    toca a propósito: la existencia física de hoy ya es la correcta.
  delete from public.ventas_productos where created_at < v_corte;
  get diagnostics v_ven = row_count;

  delete from public.inventario_movimientos where created_at < v_corte;
  get diagnostics v_inv = row_count;

  raise notice 'Corte: % (hora Colombia). Queda solo lo de esa fecha en adelante.', v_corte;
  raise notice '  · órdenes (con sus ítems): %', v_ord;
  raise notice '  · movimientos de caja: %', v_mov;
  raise notice '  · cierres de caja: %', v_cie;
  raise notice '  · liquidaciones de nómina: %', v_nom;
  raise notice '  · gastos fijos: %', v_gas;
  raise notice '  · ventas de inventario: %', v_ven;
  raise notice '  · movimientos de inventario: %', v_inv;
  raise notice '  · préstamos pagados: %', v_pre;
  if v_deuda > 0 then
    raise notice '  ⚠ % préstamo(s) viejos se conservan porque todavía tienen saldo.', v_deuda;
  end if;
  if v_cruza > 0 then
    raise notice '  ⚠ % cierre(s) abarcan ambos lados del corte: se conservan con', v_cruza;
    raise notice '    sus totales originales, pero ya no tienen todos sus movimientos.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3 — Verificación: qué quedó y desde cuándo.
-- ---------------------------------------------------------------------------
select 'ordenes'                 as tabla, count(*) as filas, min(created_at)::text   as mas_antiguo from public.ordenes
union all select 'caja_movimientos',       count(*),          min(created_at)::text                 from public.caja_movimientos
union all select 'cierres_caja',           count(*),          min(fecha_cierre)::text               from public.cierres_caja
union all select 'nomina_liquidaciones',   count(*),          min(created_at)::text                 from public.nomina_liquidaciones
union all select 'gastos_fijos',           count(*),          min(fecha)::text                      from public.gastos_fijos
union all select 'ventas_productos',       count(*),          min(created_at)::text                 from public.ventas_productos
union all select 'inventario_movimientos', count(*),          min(created_at)::text                 from public.inventario_movimientos
union all select 'prestamos',              count(*),          min(fecha)::text                      from public.prestamos;
