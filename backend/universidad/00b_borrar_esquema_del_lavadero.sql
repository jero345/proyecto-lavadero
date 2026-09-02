-- ============================================================================
-- BORRAR EL ESQUEMA DEL LAVADERO (para volver a montarlo desde cero)
--
-- Elimina las tablas del proyecto —las 15 de la versión completa o las 12 de la
-- reducida, las que estén— para dejar el Supabase de la presentación en blanco
-- y poder correr `reducido/01_schema.sql`.
--
--  ⚠️⚠️  ESTO BORRA TODOS LOS DATOS: órdenes, clientes, caja, cierres, nómina.
--        CORRELO SOLO EN EL SUPABASE DE LA PRESENTACIÓN.
--        NUNCA en el del lavadero de verdad.
--
--  Como acá no hay forma de que la base sepa sola en qué proyecto estás, el
--  seguro es manual: mientras la línea de confirmación diga 'NO', el script
--  aborta sin tocar nada.
--
--  CÓMO USARLO
--    1) Verificá que estás en el proyecto correcto (mirá el nombre arriba a la
--       izquierda en Supabase).
--    2) Cambiá abajo   v_confirmo text := 'NO';   por   := 'SI';
--    3) Supabase → SQL Editor → New query → pegar → Run.
--
--  Lo que NO se toca: tus usuarios de Authentication (auth.users). Los perfiles
--  sí se van con la tabla profiles; después de volver a crear el esquema hay que
--  insertar de nuevo la fila en `profiles` con el mismo UUID del usuario.
-- ============================================================================

do $$
declare
  -- ⬇⬇⬇  CAMBIÁ ESTO A 'SI' PARA QUE CORRA  ⬇⬇⬇
  v_confirmo text := 'NO';
  -- ⬆⬆⬆
begin
  if v_confirmo <> 'SI' then
    raise exception
      'Seguro activado: no se borró nada. Si de verdad querés vaciar ESTE proyecto, cambiá v_confirmo a ''SI'' y volvé a correrlo.';
  end if;

  -- El orden no importa: cascade se encarga de las llaves foráneas entre ellas.
  execute 'drop table if exists
      public.gastos_fijos,
      public.ventas_productos,
      public.inventario_movimientos,
      public.nomina_liquidaciones,
      public.caja_movimientos,
      public.cierres_caja,
      public.orden_items,
      public.ordenes,
      public.vehiculos,
      public.clientes,
      public.productos,
      public.servicios,
      public.tipos_vehiculo,
      public.empleados,
      public.profiles
    cascade';

  raise notice 'Esquema del lavadero borrado. Ahora podés correr reducido/01_schema.sql';
end $$;

-- ----------------------------------------------------------------------------
-- COMPROBAR QUÉ QUEDÓ (esto no borra nada, se puede correr siempre):
--
--   select table_name
--   from information_schema.tables
--   where table_schema = 'public'
--   order by table_name;
--
-- Si además habías corrido las migraciones 0002–0036 en este proyecto, quedan
-- las funciones del negocio. Para verlas:
--
--   select routine_name
--   from information_schema.routines
--   where routine_schema = 'public'
--   order by routine_name;
--
-- No estorban para el diagrama entidad-relación; si querés borrarlas igual:
--
--   drop function if exists public.NOMBRE_DE_LA_FUNCION cascade;
-- ----------------------------------------------------------------------------
