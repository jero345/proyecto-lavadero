-- ============================================================================
-- CAR WASH SERVICES — DATOS DE EJEMPLO (esquema reducido, 12 tablas)
--
-- Carga un día de operación para que en la sustentación las tablas se vean con
-- contenido y las relaciones funcionando:
--   3 trabajadores · 4 clientes · 4 productos ·
--   3 órdenes (una cobrada y entregada, una cobrada en proceso, una sin cobrar)
--   con sus servicios · los ingresos en caja · una venta de 2 productos en un
--   mismo carrito · una liquidación de nómina · y un cierre de caja de ayer.
--
-- REQUISITO: tiene que existir al menos un usuario en `profiles` (las tablas
-- guardan quién registró cada cosa). Si no lo creaste:
--   1) Supabase → Authentication → Users → Add user.
--   2) insert into public.profiles (id, nombre, rol)
--      values ('EL-UUID-DEL-USUARIO', 'Tu Nombre', 'super_admin');
--
-- Se puede volver a correr: primero borra los datos de ejemplo anteriores.
-- Va DESPUÉS de `01_schema.sql` de esta misma carpeta.
-- ============================================================================

begin;

do $$
declare
  v_uid       uuid;
  v_alex      uuid := '11111111-1111-4111-8111-111111111111';
  v_carlos    uuid := '11111111-1111-4111-8111-222222222222';
  v_jhon      uuid := '11111111-1111-4111-8111-333333333333';
  v_cli1      uuid;
  v_cli2      uuid;
  v_cli3      uuid;
  v_orden1    uuid;
  v_orden2    uuid;
  v_orden3    uuid;
  v_prod_amb  uuid;
  v_prod_micr uuid;
  v_grupo     uuid := gen_random_uuid();
  v_cierre    uuid;
  v_serv_auto uuid;
  v_serv_moto uuid;
  v_serv_plus uuid;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
begin
  -- Usuario que "registró" todo. Sin él no se puede sembrar nada.
  select id into v_uid from public.profiles order by created_at limit 1;
  if v_uid is null then
    raise exception
      'No hay ningún usuario en profiles. Creá uno en Authentication → Users y agregá su fila en profiles (ver el encabezado de este archivo).';
  end if;

  -- Servicios del catálogo que usan las órdenes de ejemplo.
  select id into v_serv_auto from public.servicios
   where nombre = 'Sencilla' and tipo_vehiculo = 'auto';
  select id into v_serv_moto from public.servicios
   where nombre = 'Sencilla' and tipo_vehiculo = 'moto';
  select id into v_serv_plus from public.servicios
   where nombre = 'Plus' and tipo_vehiculo = 'auto';
  if v_serv_auto is null then
    raise exception 'Faltan los servicios del catálogo: corré primero 01_schema.sql.';
  end if;

  -- -------------------------------------------------------------------------
  -- Limpieza de una corrida anterior (deja el catálogo y tu usuario).
  -- -------------------------------------------------------------------------
  delete from public.ventas_productos;
  delete from public.nomina_liquidaciones;
  delete from public.caja_movimientos;
  delete from public.cierres_caja;
  delete from public.orden_items;
  delete from public.ordenes;
  delete from public.clientes;
  delete from public.productos;
  delete from public.empleados;

  -- -------------------------------------------------------------------------
  -- 1) Trabajadores (roster) — no son usuarios del sistema.
  -- -------------------------------------------------------------------------
  insert into public.empleados (id, nombre, telefono, porcentaje_comision) values
    (v_alex,   'Alex Ramírez',  '3001112233', 40),
    (v_carlos, 'Carlos Gisao',  '3004445566', 45),
    (v_jhon,   'Jhon Restrepo', '3007778899', 40);

  -- -------------------------------------------------------------------------
  -- 2) Clientes.
  -- -------------------------------------------------------------------------
  insert into public.clientes (nombre, telefono, placa)
  values ('Rubén Darío Quintero', '3101112233', 'FGQ955') returning id into v_cli1;
  insert into public.clientes (nombre, telefono, placa)
  values ('María Fernanda López', '3104445566', 'KDY826') returning id into v_cli2;
  insert into public.clientes (nombre, telefono, placa)
  values ('Andrés Mejía',         '3107778899', 'ITM42F') returning id into v_cli3;
  insert into public.clientes (nombre, telefono)
  values ('Cliente ocasional', null);

  -- -------------------------------------------------------------------------
  -- 3) Productos del inventario.
  -- -------------------------------------------------------------------------
  insert into public.productos (nombre, stock_actual, stock_minimo, unidad, precio)
  values ('Ambientador grande', 6, 2, 'und', 25000) returning id into v_prod_amb;
  insert into public.productos (nombre, stock_actual, stock_minimo, unidad, precio)
  values ('Microfibra', 38, 10, 'und', 7000) returning id into v_prod_micr;
  insert into public.productos (nombre, stock_actual, stock_minimo, unidad, precio) values
    ('Limpiador de tapicería', 3, 3, 'und', 40000),
    ('Restaurador partes negras', 9, 2, 'und', 20000);

  -- -------------------------------------------------------------------------
  -- 4) Órdenes del día + sus servicios (la tabla asociativa en acción).
  -- -------------------------------------------------------------------------
  -- 4.1) Cobrada y entregada.
  insert into public.ordenes
    (cliente_id, placa, estado, metodo_pago, total, entregado_at, created_by, created_at)
  values
    (v_cli1, 'FGQ955', 'entregado', 'efectivo', 33000,
     now() - interval '2 hours', v_uid, now() - interval '5 hours')
  returning id into v_orden1;

  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  values (v_orden1, v_serv_auto, v_alex, 33000, 40);

  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, orden_id, created_by, created_at)
  values
    ('ingreso', 'Cobro orden FGQ955', 'efectivo', 33000, 'principal', v_orden1, v_uid,
     now() - interval '5 hours');

  -- 4.2) Cobrada por adelantado, todavía en proceso. Dos servicios en la misma
  --      orden: acá se ve el muchos a muchos.
  insert into public.ordenes
    (cliente_id, placa, estado, metodo_pago, total, observaciones, created_by, created_at)
  values
    (v_cli2, 'KDY826', 'en_proceso', 'qr', 76000, 'Pagó por adelantado, pasa a las 6',
     v_uid, now() - interval '3 hours')
  returning id into v_orden2;

  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje) values
    (v_orden2, v_serv_plus, v_carlos, 53000, 45),
    (v_orden2, v_serv_auto, v_jhon,   23000, 40);

  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, orden_id, created_by, created_at)
  values
    ('ingreso', 'Cobro orden KDY826', 'qr', 76000, 'principal', v_orden2, v_uid,
     now() - interval '3 hours');

  -- 4.3) Sin cobrar todavía (metodo_pago NULL).
  insert into public.ordenes
    (cliente_id, placa, estado, total, created_by, created_at)
  values
    (v_cli3, 'ITM42F', 'en_proceso', 20000, v_uid, now() - interval '1 hour')
  returning id into v_orden3;

  insert into public.orden_items (orden_id, servicio_id, empleado_id, precio, comision_porcentaje)
  values (v_orden3, v_serv_moto, v_jhon, 20000, 40);

  -- -------------------------------------------------------------------------
  -- 5) Venta de inventario: dos productos en la misma venta (carrito) →
  --    comparten venta_grupo_id y salen en una sola factura.
  -- -------------------------------------------------------------------------
  insert into public.ventas_productos
    (producto_id, producto_nombre, cantidad, precio_unitario, total, metodo_pago,
     venta_grupo_id, created_by, created_at)
  values
    (v_prod_amb,  'Ambientador grande', 1, 25000, 25000, 'efectivo', v_grupo, v_uid, now() - interval '2 hours'),
    (v_prod_micr, 'Microfibra',         2,  7000, 14000, 'efectivo', v_grupo, v_uid, now() - interval '2 hours');

  update public.productos set stock_actual = stock_actual - 1 where id = v_prod_amb;
  update public.productos set stock_actual = stock_actual - 2 where id = v_prod_micr;

  -- El dinero de los productos entra a la caja de INVENTARIO (separada).
  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_by, created_at)
  values
    ('ingreso', 'Venta: 2 productos', 'efectivo', 39000, 'inventario', v_uid,
     now() - interval '2 hours');

  -- -------------------------------------------------------------------------
  -- 6) Un egreso del día (compra de insumos).
  -- -------------------------------------------------------------------------
  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_by, created_at)
  values
    ('egreso', 'Compra de jabón', 'efectivo', 18000, 'principal', v_uid,
     now() - interval '4 hours');

  -- -------------------------------------------------------------------------
  -- 7) Nómina: se le liquida la comisión a Alex y sale su egreso de la caja.
  -- -------------------------------------------------------------------------
  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado, porcentaje, total_pagar)
  values
    (v_alex, v_hoy, v_hoy, 1, 33000, 40, 13200);

  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_by, created_at)
  values
    ('egreso', 'Nómina: Alex Ramírez (' || to_char(v_hoy,'DD/MM') || '–' || to_char(v_hoy,'DD/MM') || ')',
     'efectivo', 13200, 'principal', v_uid, now() - interval '30 minutes');

  -- -------------------------------------------------------------------------
  -- 8) Cierre de caja de AYER con sus movimientos ya consolidados: así se ve
  --    que cierre_id deja de ser NULL cuando el movimiento entra a un cierre.
  -- -------------------------------------------------------------------------
  insert into public.cierres_caja
    (caja, fecha_apertura, fecha_cierre, total_efectivo, total_qr, total_transferencia,
     total_egresos, total_nomina, total_general, created_by)
  values
    ('principal', now() - interval '1 day 10 hours', now() - interval '1 day',
     280000, 120000, 0, 25000, 60000, 315000, v_uid)
  returning id into v_cierre;

  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, cierre_id, created_by, created_at) values
    ('ingreso', 'Cobro orden GVO18I', 'efectivo', 280000, 'principal', v_cierre, v_uid, now() - interval '1 day 8 hours'),
    ('ingreso', 'Cobro orden PWV199', 'qr',       120000, 'principal', v_cierre, v_uid, now() - interval '1 day 7 hours'),
    ('egreso',  'Compra de microfibras', 'efectivo', 25000, 'principal', v_cierre, v_uid, now() - interval '1 day 6 hours'),
    ('egreso',  'Nómina: Carlos Gisao (ayer)', 'efectivo', 60000, 'principal', v_cierre, v_uid, now() - interval '1 day 2 hours');

  raise notice 'Datos de ejemplo cargados con el usuario %', v_uid;
end $$;

commit;

-- ============================================================================
-- COMPROBACIÓN RÁPIDA — cuántas filas quedaron en cada tabla:
--
--   select 'ordenes' t, count(*) from public.ordenes
--   union all select 'orden_items',          count(*) from public.orden_items
--   union all select 'clientes',             count(*) from public.clientes
--   union all select 'empleados',            count(*) from public.empleados
--   union all select 'servicios',            count(*) from public.servicios
--   union all select 'caja_movimientos',     count(*) from public.caja_movimientos
--   union all select 'cierres_caja',         count(*) from public.cierres_caja
--   union all select 'productos',            count(*) from public.productos
--   union all select 'ventas_productos',     count(*) from public.ventas_productos
--   union all select 'nomina_liquidaciones', count(*) from public.nomina_liquidaciones
--   order by 1;
-- ============================================================================
