-- ============================================================================
-- CAR WASH SERVICES — BORRAR TODAS LAS ÓRDENES (¡DESTRUCTIVO E IRREVERSIBLE!)
-- Elimina TODAS las órdenes y sus ítems, junto con los ingresos de caja que
-- esas órdenes generaron (los "Cobro orden …"), para que la caja no quede con
-- dinero de órdenes que ya no existen.
--
--  BORRA:
--    · ordenes + orden_items          (todas las órdenes y sus servicios)
--    · caja_movimientos con orden_id   (los ingresos por cobro de órdenes)
--
--  CONSERVA:
--    · clientes, empleados, servicios, productos
--    · movimientos de caja MANUALES y de NÓMINA (no atados a una orden)
--    · ventas de inventario
--
--  ⚠️  Si ya cerraste una caja que incluía cobros de órdenes, esos cierres
--      históricos quedarán con un total que ya no coincide con sus movimientos.
--      Para datos de prueba no importa; si te importa, borra también los cierres.
--  ⚠️  HAZ UN BACKUP ANTES: Supabase → Database → Backups.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

-- 1) Quitar de la caja los ingresos generados por órdenes (para no dejar plata
--    huérfana). Los movimientos manuales y de nómina (orden_id null) se quedan.
delete from public.caja_movimientos
 where orden_id is not null;

-- 2) Borrar todas las órdenes. Los orden_items se eliminan en cascada.
delete from public.ordenes;

commit;
