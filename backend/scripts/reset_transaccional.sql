-- ============================================================================
-- CAR WASH SERVICES — RESET TRANSACCIONAL (¡DESTRUCTIVO E IRREVERSIBLE!)
-- Deja la operación "en cero" para arrancar de nuevo, SIN perder los maestros.
--
--  BORRA (todo lo que es venta o mueve la caja):
--    · caja_movimientos      (movimientos de caja: ingresos/egresos)
--    · cierres_caja          (cierres de caja, principal e inventario)
--    · ordenes + orden_items (todas las órdenes y sus servicios)
--    · ventas_productos      (ventas del inventario)
--    · nomina_liquidaciones  (liquidaciones de nómina)
--
--  CONSERVA (no se tocan):
--    · clientes              (base de clientes)
--    · productos             (inventario y su stock actual)
--    · servicios             (catálogo y precios)
--    · empleados             (roster)
--    · inventario_movimientos (historial de stock — no es venta ni mueve caja)
--    · profiles / Auth, esquema, RLS y funciones
--
--  ⚠️  HAZ UN BACKUP ANTES. Esto NO se puede deshacer.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

-- Un solo TRUNCATE con las tablas transaccionales (respeta las FKs entre ellas:
-- caja_movimientos y orden_items dependen de ordenes/cierres, y van en la lista).
-- `restart identity` es inofensivo aquí (los ids son uuid).
truncate table
  public.caja_movimientos,
  public.cierres_caja,
  public.nomina_liquidaciones,
  public.ventas_productos,
  public.orden_items,
  public.ordenes
restart identity;

commit;
