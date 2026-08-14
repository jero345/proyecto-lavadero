-- ============================================================================
-- CAR WASH SERVICES — Migración 0031: el empleado opera igual que el staff
--
-- Pedido del negocio: el operario del turno tiene que poder COBRAR, COMPLETAR y
-- LIQUIDAR NÓMINA sin depender del administrador. Esta migración deja las tres
-- funciones abiertas a cualquier usuario con sesión y, de paso, corrige un
-- control de permisos que estaba roto.
--
--   1) cobrar_orden — se re-fija la versión abierta (la de 0011). En bases donde
--      quedó una versión vieja (0005/0008/0010) solo podía cobrar el staff o
--      QUIEN CREÓ la orden; el resto recibía "No autorizado".
--
--   2) avanzar_estado_orden — seguía restringida a (staff | creador | trabajador
--      asignado) y su tercera condición está MUERTA desde la migración 0007:
--      compara `orden_items.empleado_id` (que apunta al roster `empleados`,
--      trabajadores SIN login) con `auth.uid()` (un usuario del sistema). Son
--      dos universos de ids distintos, así que nunca coincide. Resultado: quien
--      no fuera staff solo podía completar/entregar las órdenes que él mismo
--      había creado. Se quita la condición muerta y se abre.
--
--   3) liquidar_nomina — se re-fija la versión abierta (la de 0024). En bases
--      con la versión de 0016 exigía rol admin/super_admin.
--
-- Coherente con la migración 0011, donde TODOS los usuarios ven TODAS las
-- órdenes: si las ves, las operás.
--
-- Lo que NO cambia: el cobro sigue siendo obligatorio antes de completar, el
-- total lo sigue calculando el servidor, no hay doble cobro, la caja y los
-- cierres siguen siendo solo del staff, y eliminar órdenes sigue siendo solo del
-- super_admin (migración 0026).
--
-- Aplicar DESPUÉS de las migraciones 0001–0030. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) cobrar_orden: cualquier usuario con sesión cobra una orden pendiente.
-- ---------------------------------------------------------------------------
create or replace function public.cobrar_orden(
  p_orden_id    uuid,
  p_metodo_pago text
)
returns public.ordenes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ordenes;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is null or p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', coalesce(p_metodo_pago, '(vacío)');
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  if v_row.metodo_pago is not null then
    raise exception 'La orden ya fue cobrada';
  end if;

  update public.ordenes set metodo_pago = p_metodo_pago
  where id = p_orden_id
  returning * into v_row;

  -- `caja` se omite a propósito: toma su default 'principal' (los ingresos de
  -- órdenes van siempre a la caja principal).
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, orden_id, created_by)
  values ('ingreso', 'Cobro orden ' || coalesce(v_row.placa,''), p_metodo_pago, v_row.total, p_orden_id, v_uid);

  return v_row;
end;
$$;

comment on function public.cobrar_orden(uuid, text) is
  'Cobra una orden pendiente + ingreso a la caja principal. Cualquier usuario con sesión.';

grant execute on function public.cobrar_orden(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) avanzar_estado_orden: se abre y se quita la condición muerta del
--    "trabajador asignado". Conserva el sello de la hora de salida (0020) y el
--    cobro obligatorio (0008).
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_estado_orden(p_orden_id uuid)
returns public.ordenes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       public.ordenes;
  v_siguiente text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  -- Cobro obligatorio: no se puede completar/entregar sin cobrar.
  if v_row.metodo_pago is null then
    raise exception 'Debe cobrar la orden antes de completarla';
  end if;

  v_siguiente := case v_row.estado
    when 'en_proceso' then 'completado'
    when 'completado' then 'entregado'
    else null
  end;
  if v_siguiente is null then
    raise exception 'La orden ya está entregada';
  end if;

  update public.ordenes
     set estado = v_siguiente,
         -- Sella la hora de salida al entregar (si aún no estaba puesta).
         entregado_at = case
           when v_siguiente = 'entregado' then coalesce(entregado_at, now())
           else entregado_at
         end
   where id = p_orden_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.avanzar_estado_orden(uuid) is
  'en_proceso -> completado -> entregado. Exige que la orden esté cobrada. Cualquier usuario con sesión.';

grant execute on function public.avanzar_estado_orden(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) liquidar_nomina: cualquier usuario con sesión puede liquidar.
--    Misma lógica de la migración 0024 (una orden = 1 servicio, se factura el
--    total real de la orden y el pago sale como egreso de la caja principal).
-- ---------------------------------------------------------------------------
create or replace function public.liquidar_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date,
  p_metodo_pago  text default 'efectivo'
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_nombre     text;
  v_porcentaje numeric;
  v_servicios  int := 0;
  v_facturado  numeric := 0;
  v_pagar      numeric := 0;
  v_row        public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  select nombre, porcentaje_comision into v_nombre, v_porcentaje
  from public.empleados where id = p_empleado_id;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;

  -- Una orden = 1 servicio: se agrupa por orden y se cuentan las órdenes.
  -- El facturado es el total real de cada orden, una sola vez.
  select coalesce(sum(x.total), 0), count(*)
    into v_facturado, v_servicios
  from (
    select o.id, o.total
    from public.ordenes o
    join public.orden_items oi on oi.orden_id = o.id
    where oi.empleado_id = p_empleado_id
      and (o.created_at at time zone 'America/Bogota')::date between p_fecha_inicio and p_fecha_fin
    group by o.id, o.total
  ) x;

  v_pagar := round(v_facturado * v_porcentaje / 100.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado, porcentaje, total_pagar)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado, v_porcentaje, v_pagar)
  returning * into v_row;

  -- El pago de la nómina sale como EGRESO de la caja principal (si hay monto).
  if v_pagar > 0 then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
    values ('egreso',
            'Nómina: ' || v_nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
            p_metodo_pago, v_pagar, 'principal', v_uid);
  end if;

  return v_row;
end;
$$;

comment on function public.liquidar_nomina(uuid, date, date, text) is
  'Liquida la comisión de un empleado en un rango + egreso en caja. Cualquier usuario con sesión.';

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

commit;

-- ============================================================================
-- ⚠️ REVISAR APARTE: EL ROL DE CADA USUARIO
--
-- El trigger handle_new_user() crea TODOS los perfiles con rol = 'empleado', y
-- la app no tiene pantalla para cambiarlo. Es muy probable que la cuenta que se
-- usa como "admin" esté guardada como 'empleado' — por eso no ve Caja ni los
-- totales, y por eso fallaban varios permisos.
--
-- Primero mirá cómo están (esto no modifica nada):
--
--   select u.email, p.nombre, p.rol, p.activo
--   from auth.users u left join public.profiles p on p.id = u.id
--   order by u.created_at;
--
-- Y corregí el que haga falta (reemplazá el correo y el rol):
--
--   update public.profiles p
--      set rol = 'admin'            -- 'super_admin' | 'admin' | 'empleado'
--    from auth.users u
--    where u.id = p.id
--      and u.email = 'correo-del-admin@ejemplo.com';
--
-- Después de cambiar el rol, el usuario debe CERRAR SESIÓN y volver a entrar
-- (la app lee el perfil al iniciar sesión).
-- ============================================================================
