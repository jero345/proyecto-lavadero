-- ============================================================================
-- ¿Qué migraciones le faltan a esta base?
--
-- Pégalo en el SQL Editor de Supabase y córrelo: no cambia nada, solo mira.
-- Cada fila dice si esa migración ya está aplicada. Corre las que digan FALTA,
-- siempre en orden de número.
-- ============================================================================

with marcas as (
  select '0037 — inventario solo super admin'      as migracion,
         to_regclass('public.productos') is not null
         and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'productos'
                        and column_name = 'activo')                        as aplicada
  union all
  select '0038 — gastos fijos siempre descuentan',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'guardar_gasto_fijo'
                    and pg_get_functiondef(p.oid) like '%Elige el método de pago del gasto%')
  union all
  select '0039 — préstamos a trabajadores',
         to_regclass('public.prestamos') is not null
         and to_regclass('public.prestamo_abonos') is not null
  union all
  select '0040 — editar/eliminar ventas',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'caja_movimientos'
                    and column_name = 'venta_grupo_id')
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'editar_venta')
  union all
  select '0041 — el admin no toca la caja de inventario',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'cerrar_caja'
                    and pg_get_functiondef(p.oid) like '%la cierra el super admin%')
  union all
  select '0042 — los préstamos no tocan la caja',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'liquidar_nomina'
                    and pg_get_function_identity_arguments(p.oid)
                        = 'p_empleado_id uuid, p_fecha_inicio date, p_fecha_fin date, p_metodo_pago text')
  union all
  select '0043 — buscador de clientes en el servidor',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'buscar_clientes')
)
select migracion,
       case when aplicada then 'OK — ya está' else 'FALTA — hay que correrla' end as estado
from marcas
order by migracion;
