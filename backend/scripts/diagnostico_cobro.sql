-- ============================================================================
-- CAR WASH SERVICES — DIAGNÓSTICO: "no deja cobrar órdenes"
-- SOLO LECTURA. No modifica nada. Seguro de correr en producción.
--
-- Pegar en: Supabase → SQL Editor → New query → Run.
-- Correr los 5 bloques y mirar los resultados en orden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ¿QUÉ ROL TIENE REALMENTE CADA USUARIO?
--    Causa #1 esperada: la cuenta que el cliente llama "admin" está guardada
--    como 'empleado'. El trigger handle_new_user() crea TODOS los perfiles con
--    rol='empleado' y no hay pantalla en la app para cambiarlo.
--    Revisar la columna `rol`: debe decir 'admin' o 'super_admin'.
-- ----------------------------------------------------------------------------
select
  u.email,
  p.nombre,
  p.rol,
  p.activo,
  case
    when p.id is null            then '❌ SIN PERFIL — no puede hacer casi nada'
    when p.activo is not true    then '❌ PERFIL DESACTIVADO'
    when p.rol = 'empleado'      then '⚠️  es EMPLEADO (¿debería ser admin?)'
    else '✅ ' || p.rol
  end as diagnostico,
  u.created_at as usuario_creado
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at;


-- ----------------------------------------------------------------------------
-- 2) ¿QUÉ VERSIÓN DE cobrar_orden ESTÁ INSTALADA?
--    La versión correcta (migración 0011_permisos_empleado) NO tiene control de
--    rol: cualquier usuario con sesión puede cobrar.
--    Si `tiene_control_de_rol` sale TRUE, la base quedó en una versión vieja
--    (0005 / 0008 / 0010) y hay migraciones sin aplicar.
-- ----------------------------------------------------------------------------
select
  p.proname as funcion,
  (p.prosrc like '%No autorizado%') as tiene_control_de_rol,
  case
    when p.proname = 'cobrar_orden' and p.prosrc like '%No autorizado%'
      then '❌ VERSIÓN VIEJA — faltan migraciones desde la 0011'
    when p.proname = 'cobrar_orden'
      then '✅ versión abierta (correcta)'
    else '(informativo)'
  end as diagnostico
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cobrar_orden','avanzar_estado_orden','crear_orden')
order by p.proname;


-- ----------------------------------------------------------------------------
-- 3) ¿QUÉ MIGRACIONES FALTAN?
--    Busca señales concretas de cada migración. Todo lo que salga ❌ está
--    pendiente de aplicar en esta base.
-- ----------------------------------------------------------------------------
select 'empleados (roster, 0007)' as señal,
       to_char(count(*),'999') as presente,
       case when count(*) > 0 then '✅' else '❌ falta 0007' end as estado
from information_schema.tables
where table_schema='public' and table_name='empleados'
union all
select 'caja_movimientos.caja (0016)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0016' end
from information_schema.columns
where table_schema='public' and table_name='caja_movimientos' and column_name='caja'
union all
select 'ordenes.entregado_at (0020)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0020' end
from information_schema.columns
where table_schema='public' and table_name='ordenes' and column_name='entregado_at'
union all
select 'tipos_vehiculo (0021)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0021' end
from information_schema.tables
where table_schema='public' and table_name='tipos_vehiculo'
union all
select 'caja_movimientos.fuera_de_caja (0025)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0025' end
from information_schema.columns
where table_schema='public' and table_name='caja_movimientos' and column_name='fuera_de_caja'
union all
select 'gastos_fijos (0027)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0027' end
from information_schema.tables
where table_schema='public' and table_name='gastos_fijos'
union all
select 'cierres_caja.total_general_manual (0029)', to_char(count(*),'999'),
       case when count(*) > 0 then '✅' else '❌ falta 0029' end
from information_schema.columns
where table_schema='public' and table_name='cierres_caja' and column_name='total_general_manual';


-- ----------------------------------------------------------------------------
-- 4) LAS ÓRDENES QUE NO DEJA COBRAR: ¿quién las creó?
--    Si la base tiene la versión vieja de cobrar_orden, solo el staff o QUIEN
--    CREÓ la orden puede cobrarla. Si el operario del turno no es el creador,
--    recibe "No autorizado".
-- ----------------------------------------------------------------------------
select
  o.placa,
  o.estado,
  o.total,
  o.created_at,
  coalesce(pc.nombre, '(desconocido)') as creada_por,
  coalesce(pc.rol, '(sin perfil)')     as rol_del_creador
from public.ordenes o
left join public.profiles pc on pc.id = o.created_by
where o.metodo_pago is null
order by o.created_at desc
limit 30;


-- ----------------------------------------------------------------------------
-- 5) COMPROBACIÓN DE LA "PUERTA MUERTA"
--    avanzar_estado_orden y las policies comparan orden_items.empleado_id con
--    auth.uid(). Desde la migración 0007 esos son dos universos de ids
--    distintos: empleado_id apunta al roster `empleados` (trabajadores SIN
--    login) y auth.uid() es un usuario del sistema.
--    Si `empleados_que_son_usuarios` da 0, esa condición NUNCA se cumple y un
--    usuario que no sea staff solo puede operar las órdenes que él mismo creó.
-- ----------------------------------------------------------------------------
select
  (select count(*) from public.empleados) as empleados_en_roster,
  (select count(*) from public.empleados e
     where exists (select 1 from public.profiles p where p.id = e.id))
    as empleados_que_son_usuarios;
