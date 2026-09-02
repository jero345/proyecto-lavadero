-- ============================================================================
-- BORRAR EL ESQUEMA DE PRUEBA (ventas / venta_items / productos / clientes)
--
-- Esto elimina las tablas del primer intento (el del diagrama con `ventas`,
-- `venta_items`, `numero_factura`, `productos.precio_unitario` y
-- `clientes.email`) para dejar el proyecto de Supabase limpio antes de correr
-- `01_schema_completo.sql`.
--
--  ⚠️  CORRELO SOLO EN EL SUPABASE DE LA PRESENTACIÓN, NUNCA EN EL DE
--      PRODUCCIÓN DEL LAVADERO. Igual el script se protege solo:
--        · Si no encuentra `ventas.numero_factura`, aborta y no borra nada.
--        · `productos` y `clientes` solo se borran si son las del esquema de
--          prueba (las de producción tienen otras columnas y quedan intactas).
--
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

do $$
declare
  v_es_demo boolean;
begin
  -- 1) Guarda de seguridad: la tabla `ventas` con `numero_factura` solo existe
  --    en el esquema de prueba. Si no está, no se toca nada.
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'ventas'
       and column_name  = 'numero_factura'
  ) into v_es_demo;

  if not v_es_demo then
    raise exception
      'Acá no está el esquema de prueba (no existe ventas.numero_factura). No se borró nada.';
  end if;

  -- 2) Las dos tablas que solo existen en el esquema de prueba.
  execute 'drop table if exists public.venta_items cascade';
  execute 'drop table if exists public.ventas cascade';

  -- 3) `productos` solo si es la de prueba (tiene precio_unitario).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'productos'
       and column_name = 'precio_unitario'
  ) then
    execute 'drop table if exists public.productos cascade';
    raise notice 'Borrada la tabla productos del esquema de prueba.';
  else
    raise notice 'productos NO se borró: no es la del esquema de prueba.';
  end if;

  -- 4) `clientes` solo si es la de prueba (tiene email).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'clientes'
       and column_name = 'email'
  ) then
    execute 'drop table if exists public.clientes cascade';
    raise notice 'Borrada la tabla clientes del esquema de prueba.';
  else
    raise notice 'clientes NO se borró: no es la del esquema de prueba.';
  end if;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- ¿Quedó algo más suelto? Con esto ves qué tablas hay en el esquema public:
--
--   select table_name
--   from information_schema.tables
--   where table_schema = 'public'
--   order by table_name;
--
-- Y para borrar alguna a mano (cuidado, no se puede deshacer):
--
--   drop table if exists public.NOMBRE_DE_LA_TABLA cascade;
-- ----------------------------------------------------------------------------
