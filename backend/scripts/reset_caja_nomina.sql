-- ============================================================================
-- CAR WASH SERVICES — RESET DE CAJA + NÓMINA (¡DESTRUCTIVO E IRREVERSIBLE!)
-- Limpia el dinero y las liquidaciones, pero CONSERVA las órdenes.
--
--  BORRA:
--    · caja_movimientos      (todos los ingresos y egresos, de ambas cajas)
--    · cierres_caja          (cierres de caja, principal e inventario)
--    · nomina_liquidaciones  (liquidaciones de nómina)
--
--  CONSERVA (no se tocan):
--    · ordenes + orden_items (las órdenes quedan intactas)
--    · ventas_productos      (ventas del inventario)
--    · clientes, servicios, empleados, productos, inventario_movimientos
--    · profiles / Auth, esquema, RLS y funciones
--
--  ⚠️  OJO: las órdenes ya cobradas quedan marcadas como pagadas, pero su
--      ingreso ya no estará en la caja (descuadre histórico esperado).
--  ⚠️  HAZ UN BACKUP ANTES. Esto NO se puede deshacer.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

-- Se borra con DELETE y no con TRUNCATE porque gastos_fijos apunta a
-- caja_movimientos: así los gastos se conservan (los que salían de la caja
-- quedan como "no afecta la caja", su egreso se fue con el resto).
delete from public.caja_movimientos;
delete from public.cierres_caja;
delete from public.nomina_liquidaciones;

commit;
