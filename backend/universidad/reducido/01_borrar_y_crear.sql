-- ============================================================================
-- CAR WASH SERVICES — MODELO NORMALIZADO (borra y crea todo, con datos)
--
-- Un solo archivo: borra lo que haya en el proyecto, crea el modelo completo,
-- los catálogos, las vistas y un día de operación de ejemplo. Se puede correr
-- las veces que haga falta.
--
--  ⚠️  EMPIEZA BORRANDO. Corrélo SOLO en el Supabase de la presentación,
--      nunca en el del lavadero de verdad. Mirá el nombre del proyecto arriba
--      a la izquierda antes de darle Run.
--
--  Pegar en: Supabase → SQL Editor → New query → Run.
--  Después: Database → Schema Visualizer para ver el diagrama.
--
-- ----------------------------------------------------------------------------
-- QUÉ CAMBIÓ RESPECTO DE LA VERSIÓN ANTERIOR (y por qué)
--
--  1) SE FUERON LOS IDS QUE NO ERAN DEL NEGOCIO.
--     Antes cinco tablas llevaban `created_by` (quién registró el dato) y
--     existía la tabla `profiles` solo para engancharse al login de Supabase.
--     Eso es auditoría de la aplicación, no parte del modelo del negocio: se
--     quitó. Son seis columnas de id y una tabla menos.
--
--  2) LA PLACA VIVE EN UN SOLO LUGAR.
--     Antes estaba repetida en `clientes` y en `ordenes` (dependencia
--     transitiva). Ahora vuelve la entidad `vehiculos`: el cliente tiene
--     vehículos y la orden apunta al vehículo. La placa está una sola vez.
--
--  3) LA VENTA DE PRODUCTOS TIENE CABECERA.
--     Antes las líneas del carrito se agrupaban por un `venta_grupo_id` suelto
--     y repetían fecha y método de pago en cada fila. Ahora es
--     `ventas` (cabecera) + `venta_detalle` (líneas), como manda el modelo
--     clásico de factura.
--
--  4) NO SE GUARDA NADA CALCULADO.
--     Se fueron `ordenes.total`, los seis totales de `cierres_caja` y el
--     `total_pagar` de la nómina. Todos salen de VISTAS (v_ordenes, v_ventas,
--     v_cierres, v_nomina). Si cambia un detalle, el total cambia solo: no hay
--     forma de que queden en desacuerdo.
--
--  5) IDS ENTEROS EN VEZ DE UUID.
--     Se leen en la sustentación (1, 2, 3) en lugar de
--     '3f2a…-9c1b'. El sistema en producción usa UUID por seguridad (los ids
--     viajan en la URL), pero para explicar el modelo estorban.
--
--  RESULTADO: 13 tablas + 4 vistas, 13 llaves foráneas (antes 23) y 3FN sin
--  excepciones.
--  Lo único “repetido” a propósito es el precio en las líneas de detalle, que
--  es el precio al que se cobró ESA vez: es un atributo del hecho, no del
--  catálogo. Es exactamente el mismo criterio del modelo clásico de factura.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) BORRAR todo lo anterior (las tablas viejas y las de este modelo).
-- ---------------------------------------------------------------------------
drop view if exists
  public.v_ordenes, public.v_ventas, public.v_cierres, public.v_nomina cascade;

drop table if exists
  public.gastos_fijos,
  public.ventas_productos,
  public.venta_detalle,
  public.ventas,
  public.venta_items,
  public.inventario_movimientos,
  public.nomina_liquidaciones,
  public.caja_movimientos,
  public.cierres_caja,
  public.orden_detalle,
  public.orden_items,
  public.ordenes,
  public.vehiculos,
  public.clientes,
  public.productos,
  public.servicios,
  public.tipos_vehiculo,
  public.empleados,
  public.profiles
cascade;

-- ===========================================================================
--  CATÁLOGOS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) tipos_vehiculo — de qué es el vehículo. Es catálogo y no un texto suelto
--    porque de él depende la tarifa.
-- ---------------------------------------------------------------------------
create table public.tipos_vehiculo (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);
comment on table public.tipos_vehiculo is
  'Catálogo: moto, moto de alto cilindraje, auto, camioneta.';

-- ---------------------------------------------------------------------------
-- 2) servicios — el catálogo de precios. Una fila por servicio Y tipo de
--    vehículo, porque el precio depende de los dos: la lavada sencilla vale
--    $20.000 en moto y $33.000 en auto. (nombre, tipo_vehiculo_id) es la
--    clave natural.
-- ---------------------------------------------------------------------------
create table public.servicios (
  id               bigint generated always as identity primary key,
  categoria        text not null,
  nombre           text not null,
  tipo_vehiculo_id bigint not null references public.tipos_vehiculo(id) on delete restrict,
  precio           numeric(12,2) not null check (precio >= 0),
  activo           boolean not null default true,
  unique (nombre, tipo_vehiculo_id)
);
comment on table public.servicios is
  'Tarifas. El precio depende del servicio Y del tipo de vehículo.';

-- ---------------------------------------------------------------------------
-- 3) productos — lo que se vende aparte del lavado.
-- ---------------------------------------------------------------------------
create table public.productos (
  id           bigint generated always as identity primary key,
  nombre       text not null unique,
  precio       numeric(12,2) not null check (precio >= 0),
  stock_actual integer not null default 0 check (stock_actual >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0)
);
comment on table public.productos is
  'Productos de inventario (ambientadores, microfibras) con su stock.';

-- ===========================================================================
--  PERSONAS Y VEHÍCULOS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4) empleados — los trabajadores del lavadero, con su % de comisión.
-- ---------------------------------------------------------------------------
create table public.empleados (
  id                  bigint generated always as identity primary key,
  nombre              text not null,
  telefono            text,
  porcentaje_comision numeric(5,2) not null default 40
                        check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo              boolean not null default true
);
comment on table public.empleados is
  'Trabajadores. De su porcentaje sale la comisión de cada servicio que hacen.';

-- ---------------------------------------------------------------------------
-- 5) clientes — los dueños de los vehículos.
-- ---------------------------------------------------------------------------
create table public.clientes (
  id       bigint generated always as identity primary key,
  nombre   text not null,
  telefono text
);
comment on table public.clientes is 'Clientes del lavadero.';

-- ---------------------------------------------------------------------------
-- 6) vehiculos — la placa vive acá y en ningún otro lado.
-- ---------------------------------------------------------------------------
create table public.vehiculos (
  id               bigint generated always as identity primary key,
  cliente_id       bigint not null references public.clientes(id) on delete cascade,
  tipo_vehiculo_id bigint not null references public.tipos_vehiculo(id) on delete restrict,
  placa            text not null unique
);
comment on table public.vehiculos is
  'Vehículos de cada cliente. La placa es única: identifica el carro en el patio.';
create index idx_vehiculos_cliente on public.vehiculos(cliente_id);

-- ===========================================================================
--  OPERACIÓN: LA ORDEN DE SERVICIO
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7) ordenes — un vehículo que entra a lavarse.
--    NO guarda el total (sale de v_ordenes) ni la placa (está en vehiculos)
--    ni el cliente (se llega por el vehículo).
-- ---------------------------------------------------------------------------
create table public.ordenes (
  id            bigint generated always as identity primary key,
  vehiculo_id   bigint not null references public.vehiculos(id) on delete restrict,
  fecha_ingreso timestamptz not null default now(),
  fecha_entrega timestamptz,
  estado        text not null default 'en_proceso'
                  check (estado in ('en_proceso','completado','entregado')),
  metodo_pago   text check (metodo_pago in ('efectivo','qr','transferencia')),
  observaciones text,
  -- No se puede entregar antes de recibir.
  check (fecha_entrega is null or fecha_entrega >= fecha_ingreso)
);
comment on table public.ordenes is
  'Órdenes de servicio. metodo_pago NULL = todavía sin cobrar.';
comment on column public.ordenes.metodo_pago is
  'NULL = sin cobrar. Al cobrar se llena y nace el ingreso en caja_movimientos.';
create index idx_ordenes_vehiculo on public.ordenes(vehiculo_id);
create index idx_ordenes_fecha    on public.ordenes(fecha_ingreso);

-- ---------------------------------------------------------------------------
-- 8) orden_detalle — TABLA ASOCIATIVA: resuelve el muchos a muchos entre
--    órdenes y servicios, y guarda los atributos propios de la relación:
--    el precio al que se cobró, el % pactado y quién hizo el trabajo.
--    Un mismo servicio no se repite dentro de una orden (clave única).
-- ---------------------------------------------------------------------------
create table public.orden_detalle (
  id                  bigint generated always as identity primary key,
  orden_id            bigint not null references public.ordenes(id)   on delete cascade,
  servicio_id         bigint not null references public.servicios(id) on delete restrict,
  empleado_id         bigint not null references public.empleados(id) on delete restrict,
  precio              numeric(12,2) not null check (precio >= 0),
  comision_porcentaje numeric(5,2) not null
                        check (comision_porcentaje >= 0 and comision_porcentaje <= 100),
  unique (orden_id, servicio_id)
);
comment on table public.orden_detalle is
  'Servicios de cada orden. El precio es el del momento, no el del catálogo de hoy.';
create index idx_detalle_empleado on public.orden_detalle(empleado_id);

-- ===========================================================================
--  VENTA DE PRODUCTOS (cabecera + detalle, como una factura)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 9) ventas — la cabecera: lo que es igual para todo el carrito.
-- ---------------------------------------------------------------------------
create table public.ventas (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  metodo_pago text not null check (metodo_pago in ('efectivo','qr','transferencia'))
);
comment on table public.ventas is
  'Cabecera de la venta de productos: una por carrito, con su método de pago.';

-- ---------------------------------------------------------------------------
-- 10) venta_detalle — una línea por producto vendido.
-- ---------------------------------------------------------------------------
create table public.venta_detalle (
  id              bigint generated always as identity primary key,
  venta_id        bigint not null references public.ventas(id)    on delete cascade,
  producto_id     bigint not null references public.productos(id) on delete restrict,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  unique (venta_id, producto_id)
);
comment on table public.venta_detalle is
  'Líneas de la venta. El subtotal no se guarda: cantidad × precio_unitario.';

-- ===========================================================================
--  DINERO: CAJA Y CIERRES
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 11) cierres_caja — el corte del turno. Sin totales: los calcula v_cierres.
-- ---------------------------------------------------------------------------
create table public.cierres_caja (
  id             bigint generated always as identity primary key,
  fecha_apertura timestamptz not null,
  fecha_cierre   timestamptz not null default now(),
  check (fecha_cierre >= fecha_apertura)
);
comment on table public.cierres_caja is
  'Cortes de caja. Los totales salen de la vista v_cierres, no se guardan.';

-- ---------------------------------------------------------------------------
-- 12) caja_movimientos — todo el dinero que entra y sale.
--     De dónde vino: de una orden, de una venta, o de ninguna de las dos
--     (compras, pago de nómina). Nunca de las dos a la vez.
--     cierre_id NULL = todavía en la caja abierta.
-- ---------------------------------------------------------------------------
create table public.caja_movimientos (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  tipo        text not null check (tipo in ('ingreso','egreso')),
  concepto    text not null,
  monto       numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo','qr','transferencia')),
  orden_id    bigint references public.ordenes(id)      on delete set null,
  venta_id    bigint references public.ventas(id)       on delete set null,
  cierre_id   bigint references public.cierres_caja(id) on delete set null,
  -- Un movimiento no puede venir de una orden Y de una venta al mismo tiempo.
  check (num_nonnulls(orden_id, venta_id) <= 1)
);
comment on table public.caja_movimientos is
  'Movimientos de caja. cierre_id NULL = aún sin cerrar; al cerrar recibe el id del corte.';
create index idx_caja_cierre on public.caja_movimientos(cierre_id);
create index idx_caja_fecha  on public.caja_movimientos(fecha);

-- ---------------------------------------------------------------------------
-- 13) nomina_liquidaciones — el periodo liquidado de un trabajador. Guarda el
--     porcentaje pactado (dato histórico); cuánto se le paga lo calcula
--     v_nomina a partir de los servicios que hizo en esas fechas.
-- ---------------------------------------------------------------------------
create table public.nomina_liquidaciones (
  id           bigint generated always as identity primary key,
  empleado_id  bigint not null references public.empleados(id) on delete restrict,
  fecha_inicio date not null,
  fecha_fin    date not null,
  porcentaje   numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  check (fecha_fin >= fecha_inicio),
  unique (empleado_id, fecha_inicio, fecha_fin)
);
comment on table public.nomina_liquidaciones is
  'Periodos de nómina ya liquidados. El monto lo calcula la vista v_nomina.';

-- ===========================================================================
--  VISTAS — acá viven los datos calculados, para no guardarlos en las tablas
-- ===========================================================================

-- Orden con su cliente, su placa y el total sumado de sus servicios.
create view public.v_ordenes as
select
  o.id                                   as orden_id,
  o.fecha_ingreso,
  o.fecha_entrega,
  o.estado,
  o.metodo_pago,
  v.placa,
  tv.nombre                              as tipo_vehiculo,
  c.nombre                               as cliente,
  count(d.id)                            as servicios,
  coalesce(sum(d.precio), 0)             as total
from public.ordenes o
join public.vehiculos v       on v.id  = o.vehiculo_id
join public.clientes c        on c.id  = v.cliente_id
join public.tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
left join public.orden_detalle d on d.orden_id = o.id
group by o.id, v.placa, tv.nombre, c.nombre;

comment on view public.v_ordenes is
  'Órdenes con su total calculado: por eso ordenes no guarda la columna total.';

-- Venta de productos con sus unidades y su total.
create view public.v_ventas as
select
  ve.id                                              as venta_id,
  ve.fecha,
  ve.metodo_pago,
  sum(vd.cantidad)                                   as unidades,
  sum(vd.cantidad * vd.precio_unitario)              as total
from public.ventas ve
join public.venta_detalle vd on vd.venta_id = ve.id
group by ve.id;

comment on view public.v_ventas is
  'Ventas con el total sumado de sus líneas.';

-- Cierre de caja con el desglose por método de pago.
create view public.v_cierres as
select
  cc.id as cierre_id,
  cc.fecha_apertura,
  cc.fecha_cierre,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso' and m.metodo_pago = 'efectivo'), 0)      as efectivo,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso' and m.metodo_pago = 'qr'), 0)            as qr,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso' and m.metodo_pago = 'transferencia'), 0) as transferencia,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso'), 0)                                     as total_ingresos,
  coalesce(sum(m.monto) filter (where m.tipo = 'egreso'), 0)                                      as total_egresos,
  coalesce(sum(m.monto) filter (where m.tipo = 'ingreso'), 0)
    - coalesce(sum(m.monto) filter (where m.tipo = 'egreso'), 0)                                  as total_general
from public.cierres_caja cc
left join public.caja_movimientos m on m.cierre_id = cc.id
group by cc.id;

comment on view public.v_cierres is
  'Totales de cada cierre calculados desde sus movimientos: nunca quedan descuadrados.';

-- Liquidación de nómina con lo facturado y lo que se le paga al trabajador.
create view public.v_nomina as
select
  l.id                                        as liquidacion_id,
  e.nombre                                    as empleado,
  l.fecha_inicio,
  l.fecha_fin,
  l.porcentaje,
  count(t.orden_id)                           as servicios,
  coalesce(sum(t.precio), 0)                  as facturado,
  round(coalesce(sum(t.precio), 0) * l.porcentaje / 100) as total_pagar
from public.nomina_liquidaciones l
join public.empleados e on e.id = l.empleado_id
left join (
  select d.empleado_id,
         d.orden_id,
         d.precio,
         (o.fecha_ingreso at time zone 'America/Bogota')::date as dia
  from public.orden_detalle d
  join public.ordenes o on o.id = d.orden_id
) t on t.empleado_id = l.empleado_id
   and t.dia between l.fecha_inicio and l.fecha_fin
group by l.id, e.nombre;

comment on view public.v_nomina is
  'Lo que se le paga a cada trabajador, calculado desde los servicios que hizo en el periodo.';

-- ===========================================================================
--  DATOS DE EJEMPLO — un día de operación
--  Los ids salen 1, 2, 3… porque las tablas se acaban de crear.
-- ===========================================================================

insert into public.tipos_vehiculo (nombre) values
  ('Moto'),                    -- 1
  ('Moto alto cilindraje'),    -- 2
  ('Auto'),                    -- 3
  ('Camioneta');               -- 4

insert into public.servicios (categoria, nombre, tipo_vehiculo_id, precio) values
  ('Lavado', 'Sencilla',            3, 33000),   -- 1  auto
  ('Lavado', 'Plus',                3, 53000),   -- 2  auto
  ('Lavado', 'Máster',              3, 65000),   -- 3  auto
  ('Lavado', 'Sencilla',            1, 20000),   -- 4  moto
  ('Lavado', 'Desengrasada',        1, 27000),   -- 5  moto
  ('Lavado', 'Sencilla',            2, 24000),   -- 6  moto alto
  ('Lavado', 'Sencilla',            4, 39000),   -- 7  camioneta
  ('Otros',  'Aspirada',            3, 23000),   -- 8  auto
  ('Otros',  'Brillada con máquina',3, 100000),  -- 9  auto
  ('Otros',  'Aspirada',            4, 25000);   -- 10 camioneta

insert into public.productos (nombre, precio, stock_actual, stock_minimo) values
  ('Ambientador grande',       25000,  5, 2),   -- 1 (ya descontado el vendido)
  ('Microfibra',                7000, 36, 10),  -- 2 (ya descontados los 2)
  ('Limpiador de tapicería',   40000,  3,  3),  -- 3
  ('Restaurador partes negras',20000,  9,  2);  -- 4

insert into public.empleados (nombre, telefono, porcentaje_comision) values
  ('Alex Ramírez',  '3001112233', 40),   -- 1
  ('Carlos Gisao',  '3004445566', 45),   -- 2
  ('Jhon Restrepo', '3007778899', 40);   -- 3

insert into public.clientes (nombre, telefono) values
  ('Rubén Darío Quintero', '3101112233'),  -- 1
  ('María Fernanda López', '3104445566'),  -- 2
  ('Andrés Mejía',         '3107778899'),  -- 3
  ('Sandra Ocampo',        '3102223344');  -- 4

insert into public.vehiculos (cliente_id, tipo_vehiculo_id, placa) values
  (1, 3, 'FGQ955'),   -- 1  auto de Rubén
  (2, 3, 'KDY826'),   -- 2  auto de María Fernanda
  (3, 1, 'ITM42F'),   -- 3  moto de Andrés
  (4, 4, 'QMO879'),   -- 4  camioneta de Sandra
  (1, 1, 'CPH49E');   -- 5  Rubén también tiene moto

-- Orden 1: cobrada y entregada.
insert into public.ordenes (vehiculo_id, fecha_ingreso, fecha_entrega, estado, metodo_pago) values
  (1, now() - interval '5 hours', now() - interval '2 hours', 'entregado', 'efectivo');
insert into public.orden_detalle (orden_id, servicio_id, empleado_id, precio, comision_porcentaje) values
  (1, 1, 1, 33000, 40);

-- Orden 2: pagada por adelantado, todavía en proceso. DOS servicios y DOS
-- trabajadores distintos: acá se ve el muchos a muchos.
insert into public.ordenes (vehiculo_id, fecha_ingreso, estado, metodo_pago, observaciones) values
  (2, now() - interval '3 hours', 'en_proceso', 'qr', 'Pagó por adelantado, pasa a las 6');
insert into public.orden_detalle (orden_id, servicio_id, empleado_id, precio, comision_porcentaje) values
  (2, 2, 2, 53000, 45),
  (2, 8, 3, 23000, 40);

-- Orden 3: todavía sin cobrar (metodo_pago NULL).
insert into public.ordenes (vehiculo_id, fecha_ingreso, estado) values
  (3, now() - interval '1 hour', 'en_proceso');
insert into public.orden_detalle (orden_id, servicio_id, empleado_id, precio, comision_porcentaje) values
  (3, 4, 3, 20000, 40);

-- Venta de productos: un carrito con dos líneas.
insert into public.ventas (fecha, metodo_pago) values
  (now() - interval '2 hours', 'efectivo');
insert into public.venta_detalle (venta_id, producto_id, cantidad, precio_unitario) values
  (1, 1, 1, 25000),
  (1, 2, 2,  7000);

-- Cierre de AYER, con sus movimientos ya consolidados.
insert into public.cierres_caja (fecha_apertura, fecha_cierre) values
  (now() - interval '1 day 10 hours', now() - interval '1 day');

insert into public.caja_movimientos (fecha, tipo, concepto, monto, metodo_pago, cierre_id) values
  (now() - interval '1 day 8 hours', 'ingreso', 'Cobro orden GVO18I',    280000, 'efectivo', 1),
  (now() - interval '1 day 7 hours', 'ingreso', 'Cobro orden PWV199',    120000, 'qr',       1),
  (now() - interval '1 day 6 hours', 'egreso',  'Compra de microfibras',  25000, 'efectivo', 1),
  (now() - interval '1 day 2 hours', 'egreso',  'Nómina: Carlos Gisao',   60000, 'efectivo', 1);

-- Movimientos de HOY, todavía sin cerrar (cierre_id NULL).
insert into public.caja_movimientos (fecha, tipo, concepto, monto, metodo_pago, orden_id, venta_id) values
  (now() - interval '5 hours', 'ingreso', 'Cobro orden 1',      33000, 'efectivo', 1,    null),
  (now() - interval '3 hours', 'ingreso', 'Cobro orden 2',      76000, 'qr',       2,    null),
  (now() - interval '2 hours', 'ingreso', 'Venta de productos', 39000, 'efectivo', null, 1),
  (now() - interval '4 hours', 'egreso',  'Compra de jabón',    18000, 'efectivo', null, null);

-- Nómina de hoy para Alex (el monto lo calcula v_nomina).
insert into public.nomina_liquidaciones (empleado_id, fecha_inicio, fecha_fin, porcentaje) values
  (1, (now() at time zone 'America/Bogota')::date, (now() at time zone 'America/Bogota')::date, 40);

insert into public.caja_movimientos (fecha, tipo, concepto, monto, metodo_pago) values
  (now() - interval '30 minutes', 'egreso', 'Nómina: Alex Ramírez', 13200, 'efectivo');

-- ---------------------------------------------------------------------------
-- SEGURIDAD — RLS activo, como pide Supabase. Sin políticas nadie entra por la
-- API pública; el panel (Table Editor y SQL Editor) sigue funcionando porque
-- usa la llave de servicio.
-- ---------------------------------------------------------------------------
alter table public.tipos_vehiculo       enable row level security;
alter table public.servicios            enable row level security;
alter table public.productos            enable row level security;
alter table public.empleados            enable row level security;
alter table public.clientes             enable row level security;
alter table public.vehiculos            enable row level security;
alter table public.ordenes              enable row level security;
alter table public.orden_detalle        enable row level security;
alter table public.ventas               enable row level security;
alter table public.venta_detalle        enable row level security;
alter table public.cierres_caja         enable row level security;
alter table public.caja_movimientos     enable row level security;
alter table public.nomina_liquidaciones enable row level security;

commit;

-- ============================================================================
-- PARA MOSTRAR EN LA SUSTENTACIÓN (copiá y corré cualquiera):
--
--   -- Las órdenes con su cliente, su placa y su total CALCULADO:
--   select * from public.v_ordenes order by orden_id;
--
--   -- El detalle de la orden 2: dos servicios, dos trabajadores:
--   select o.orden_id, s.nombre as servicio, e.nombre as trabajador, d.precio
--   from public.orden_detalle d
--   join public.v_ordenes o on o.orden_id = d.orden_id
--   join public.servicios s on s.id = d.servicio_id
--   join public.empleados e on e.id = d.empleado_id
--   where d.orden_id = 2;
--
--   -- La venta de productos con su total:
--   select * from public.v_ventas;
--
--   -- El cierre de ayer, cuadrado desde sus movimientos:
--   select * from public.v_cierres;
--
--   -- Lo que se le paga a cada trabajador:
--   select * from public.v_nomina;
-- ============================================================================
