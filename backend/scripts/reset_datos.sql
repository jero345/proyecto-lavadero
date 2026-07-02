-- ============================================================================
-- CAR WASH SERVICES — RESET de datos (¡DESTRUCTIVO E IRREVERSIBLE!)
-- Deja la base "en cero" para arrancar en producción.
--
--  BORRA:  órdenes, ítems, caja, cierres, nómina, ventas de productos,
--          movimientos de inventario, productos, clientes, vehículos y el
--          ROSTER de empleados (tabla `empleados`).
--  CONSERVA: catálogo de `servicios`, usuarios/logins (`profiles` + Auth),
--            esquema, RLS y funciones.
--
--  ⚠️  HAZ UN BACKUP ANTES. Esto no se puede deshacer.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

-- Un solo TRUNCATE con todas las tablas relacionadas (respeta las FKs entre
-- ellas). `restart identity` es inofensivo aquí (los ids son uuid).
truncate table
  public.caja_movimientos,
  public.cierres_caja,
  public.nomina_liquidaciones,
  public.ventas_productos,
  public.inventario_movimientos,
  public.orden_items,
  public.ordenes,
  public.vehiculos,
  public.clientes,
  public.productos,
  public.empleados
restart identity;

commit;

-- ----------------------------------------------------------------------------
-- OPCIONAL — si además quieres reiniciar el CATÁLOGO de servicios a los precios
-- originales del seed, descomenta y ejecuta también esto:
--
--   truncate table public.servicios cascade;
--   -- luego vuelve a correr el bloque de INSERT del seed de
--   -- backend/migrations/0001_schema_inicial.sql
-- ----------------------------------------------------------------------------
