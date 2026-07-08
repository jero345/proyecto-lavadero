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

-- caja_movimientos referencia a cierres_caja (cierre_id): van en el mismo
-- TRUNCATE para respetar la FK. nomina_liquidaciones es independiente.
truncate table
  public.caja_movimientos,
  public.cierres_caja,
  public.nomina_liquidaciones
restart identity;

commit;
