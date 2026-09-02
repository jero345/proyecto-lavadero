-- ============================================================================
-- CAR WASH SERVICES — ESQUEMA COMPLETO (para montar la base desde cero)
--
-- Este archivo deja la base de datos EXACTAMENTE como está en producción, pero
-- en un solo script: es el resultado consolidado de las migraciones 0001–0036.
-- Sirve para levantar el proyecto en un Supabase nuevo (por ejemplo, el de la
-- presentación) y para que el visor de esquemas dibuje el MODELO ENTIDAD-
-- RELACIÓN con todas sus llaves foráneas.
--
-- CÓMO USARLO
--   1) Supabase → SQL Editor → New query → pegar todo → Run.
--   2) Después, para ver el diagrama: Database → Schema Visualizer.
--   3) Si querés datos de ejemplo, corré luego `02_datos_demo.sql`.
--
-- QUÉ CREA (15 tablas)
--   Maestros:      profiles · empleados · clientes · vehiculos ·
--                  tipos_vehiculo · servicios · productos
--   Operación:     ordenes · orden_items
--   Dinero:        caja_movimientos · cierres_caja · gastos_fijos ·
--                  ventas_productos · nomina_liquidaciones
--   Inventario:    inventario_movimientos
--
-- NOTA: acá van las TABLAS (entidades y relaciones). La lógica de negocio
-- (funciones SECURITY DEFINER como crear_orden, cobrar_orden, cerrar_caja,
-- liquidar_nomina…) y las políticas RLS viven en las migraciones 0002–0036;
-- si querés la app funcionando de verdad, corré esas migraciones en orden.
-- ============================================================================

begin;

-- gen_random_uuid() para las llaves primarias.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) profiles — USUARIOS DEL SISTEMA (los que inician sesión).
--    Relación 1:1 con auth.users (el módulo de autenticación de Supabase).
--    Los usuarios se DESACTIVAN (activo = false), no se borran: por eso las FKs
--    created_by usan ON DELETE RESTRICT (protegen el historial).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nombre              text not null,
  rol                 text not null default 'empleado'
                        check (rol in ('super_admin','admin','empleado')),
  porcentaje_comision numeric not null default 40
                        check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);
comment on table public.profiles is
  'Usuarios del sistema (login) con su rol. id = auth.users.id';

-- ---------------------------------------------------------------------------
-- 2) empleados — TRABAJADORES del lavadero (roster). NO inician sesión:
--    son a quienes se les asigna una orden y se les liquida la comisión.
-- ---------------------------------------------------------------------------
create table if not exists public.empleados (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  telefono            text,
  porcentaje_comision numeric not null default 40
                        check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo              boolean not null default true,
  observaciones       text,
  created_at          timestamptz not null default now()
);
comment on table public.empleados is
  'Trabajadores asignables a órdenes (comisión/nómina). NO son usuarios del sistema.';
create index if not exists idx_empleados_activo on public.empleados(activo);

-- ---------------------------------------------------------------------------
-- 3) clientes — dueños de los vehículos.
-- ---------------------------------------------------------------------------
create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  placa      text,
  created_at timestamptz not null default now()
);
comment on table public.clientes is
  'Clientes del lavadero. La placa identifica al cliente cuando se repite.';

-- Sin duplicados: por placa normalizada (si la tiene) o por nombre normalizado.
create unique index if not exists uq_clientes_placa_norm
  on public.clientes (upper(regexp_replace(placa, '\s', '', 'g')))
  where placa is not null and btrim(placa) <> '';
create unique index if not exists uq_clientes_nombre_norm
  on public.clientes (upper(regexp_replace(nombre, '\s', '', 'g')))
  where placa is null or btrim(placa) = '';

-- ---------------------------------------------------------------------------
-- 4) vehiculos — placa + tipo, opcionalmente ligados a un cliente.
-- ---------------------------------------------------------------------------
create table if not exists public.vehiculos (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  placa      text not null,
  tipo       text not null
);
comment on table public.vehiculos is
  'Vehículos registrados (placa + tipo). El tipo define qué servicios aplican.';
create index if not exists idx_vehiculos_cliente on public.vehiculos(cliente_id);
create index if not exists idx_vehiculos_placa   on public.vehiculos(placa);

-- ---------------------------------------------------------------------------
-- 5) tipos_vehiculo — catálogo dinámico (moto, auto, camioneta…).
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_vehiculo (
  codigo     text primary key,
  nombre     text not null,
  orden      int not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.tipos_vehiculo is
  'Catálogo de tipos de vehículo. codigo = valor usado en servicios.tipo_vehiculo.';

-- ---------------------------------------------------------------------------
-- 6) servicios — catálogo de precios: una fila por servicio + tipo de vehículo.
-- ---------------------------------------------------------------------------
create table if not exists public.servicios (
  id            uuid primary key default gen_random_uuid(),
  categoria     text not null,
  nombre        text not null,
  descripcion   text,
  tipo_vehiculo text not null references public.tipos_vehiculo(codigo) on delete restrict,
  precio        numeric not null check (precio >= 0),
  activo        boolean not null default true,
  unique (nombre, tipo_vehiculo)
);
comment on table public.servicios is
  'Catálogo de servicios. Clave natural (nombre, tipo_vehiculo) para evitar duplicados.';
create index if not exists idx_servicios_tipo      on public.servicios(tipo_vehiculo);
create index if not exists idx_servicios_categoria on public.servicios(categoria);
create index if not exists idx_servicios_activo    on public.servicios(activo);

-- ---------------------------------------------------------------------------
-- 7) cierres_caja — corte del día. Se crea antes de caja_movimientos porque
--    cada movimiento apunta al cierre que lo consolidó.
--    Los egresos se desglosan en tres: del día, nómina y gastos fijos.
-- ---------------------------------------------------------------------------
create table if not exists public.cierres_caja (
  id                        uuid primary key default gen_random_uuid(),
  caja                      text not null default 'principal'
                              check (caja in ('principal','inventario')),
  fecha_apertura            timestamptz,
  fecha_cierre              timestamptz not null default now(),
  total_efectivo            numeric not null default 0,
  total_qr                  numeric not null default 0,
  total_transferencia       numeric not null default 0,
  total_egresos             numeric not null default 0,
  total_nomina              numeric not null default 0,
  total_gastos              numeric not null default 0,
  total_general             numeric not null default 0,
  total_general_manual      boolean not null default false,
  total_general_editado_por uuid references public.profiles(id),
  total_general_editado_at  timestamptz,
  created_by                uuid not null references public.profiles(id) on delete restrict
);
comment on table public.cierres_caja is
  'Cierres de caja (principal e inventario, por separado). Los totales los calcula cerrar_caja().';
comment on column public.cierres_caja.total_gastos is
  'Gastos fijos (arriendo, servicios) del cierre: no entran en total_egresos, pero sí restan del total_general.';

-- ---------------------------------------------------------------------------
-- 8) ordenes — el corazón del negocio: un vehículo que entra a lavarse.
-- ---------------------------------------------------------------------------
create table if not exists public.ordenes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid references public.clientes(id)  on delete set null,
  vehiculo_id   uuid references public.vehiculos(id) on delete set null,
  placa         text,
  estado        text not null default 'en_proceso'
                  check (estado in ('en_proceso','completado','entregado')),
  metodo_pago   text check (metodo_pago in ('efectivo','qr','transferencia')),
  total         numeric not null default 0 check (total >= 0),
  observaciones text,
  foto_url      text,
  entregado_at  timestamptz,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now()
);
comment on table public.ordenes is
  'Órdenes de servicio. El total lo calcula el servidor: nunca se confía en el cliente.';
comment on column public.ordenes.metodo_pago is
  'NULL = todavía sin cobrar. Al cobrar se llena y nace el ingreso en caja.';
create index if not exists idx_ordenes_created_by on public.ordenes(created_by);
create index if not exists idx_ordenes_created_at on public.ordenes(created_at);
create index if not exists idx_ordenes_estado     on public.ordenes(estado);
create index if not exists idx_ordenes_placa      on public.ordenes(placa);

-- ---------------------------------------------------------------------------
-- 9) orden_items — qué servicios se le hicieron a esa orden y quién los hizo.
--    empleado_id puede ser NULL: la orden se puede abrir sin asignar trabajador.
-- ---------------------------------------------------------------------------
create table if not exists public.orden_items (
  id                  uuid primary key default gen_random_uuid(),
  orden_id            uuid not null references public.ordenes(id)   on delete cascade,
  servicio_id         uuid not null references public.servicios(id) on delete restrict,
  empleado_id         uuid references public.empleados(id) on delete restrict,
  precio              numeric not null check (precio >= 0),
  comision_porcentaje numeric not null default 40
                        check (comision_porcentaje >= 0 and comision_porcentaje <= 100)
);
comment on table public.orden_items is
  'Servicios de cada orden. empleado_id define de quién es la comisión en la nómina.';
create index if not exists idx_orden_items_orden    on public.orden_items(orden_id);
create index if not exists idx_orden_items_empleado on public.orden_items(empleado_id);
create index if not exists idx_orden_items_servicio on public.orden_items(servicio_id);

-- ---------------------------------------------------------------------------
-- 10) caja_movimientos — TODO el dinero que entra y sale.
--     Hay dos cajas independientes: 'principal' (servicios) e 'inventario'
--     (venta de productos). cierre_id NULL = todavía sin cerrar.
-- ---------------------------------------------------------------------------
create table if not exists public.caja_movimientos (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('ingreso','egreso')),
  concepto      text,
  metodo_pago   text check (metodo_pago in ('efectivo','qr','transferencia')),
  monto         numeric not null check (monto >= 0),
  caja          text not null default 'principal'
                  check (caja in ('principal','inventario')),
  fuera_de_caja boolean not null default false,
  orden_id      uuid references public.ordenes(id)      on delete set null,
  cierre_id     uuid references public.cierres_caja(id) on delete set null,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now()
);
comment on table public.caja_movimientos is
  'Movimientos de caja. cierre_id NULL = aún sin cerrar (lo consume cerrar_caja).';
comment on column public.caja_movimientos.fuera_de_caja is
  'true = registrado con fecha de otro día: queda en el historial pero no entra a la caja abierta.';
create index if not exists idx_caja_cierre     on public.caja_movimientos(cierre_id);
create index if not exists idx_caja_created_at on public.caja_movimientos(created_at);
create index if not exists idx_caja_created_by on public.caja_movimientos(created_by);
create index if not exists idx_caja_orden      on public.caja_movimientos(orden_id);
create index if not exists idx_caja_mov_caja   on public.caja_movimientos(caja);
-- Índice parcial: "los movimientos abiertos de verdad" son los que más se leen.
create index if not exists idx_caja_abiertos_reales
  on public.caja_movimientos(caja, created_at)
  where cierre_id is null and not fuera_de_caja;

-- ---------------------------------------------------------------------------
-- 11) productos — inventario que se vende (ambientadores, microfibras…).
-- ---------------------------------------------------------------------------
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  stock_actual numeric not null default 0,
  stock_minimo numeric not null default 0,
  unidad       text,
  precio       numeric not null default 0 check (precio >= 0)
);
comment on table public.productos is
  'Productos de inventario con precio de venta y alerta de stock mínimo.';

-- ---------------------------------------------------------------------------
-- 12) inventario_movimientos — historial de entradas y salidas de stock.
-- ---------------------------------------------------------------------------
create table if not exists public.inventario_movimientos (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo        text not null check (tipo in ('entrada','salida')),
  cantidad    numeric not null check (cantidad > 0),
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);
comment on table public.inventario_movimientos is
  'Entradas/salidas de stock. Cada venta genera su salida.';
create index if not exists idx_inv_mov_producto on public.inventario_movimientos(producto_id);

-- ---------------------------------------------------------------------------
-- 13) ventas_productos — venta de inventario. Una fila por producto vendido;
--     las de una misma venta (carrito) comparten venta_grupo_id y salen en
--     una sola factura.
-- ---------------------------------------------------------------------------
create table if not exists public.ventas_productos (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references public.productos(id) on delete set null,
  producto_nombre text not null,
  cantidad        numeric not null check (cantidad > 0),
  precio_unitario numeric not null check (precio_unitario >= 0),
  total           numeric not null check (total >= 0),
  metodo_pago     text not null check (metodo_pago in ('efectivo','qr','transferencia')),
  venta_grupo_id  uuid,
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now()
);
comment on table public.ventas_productos is
  'Ventas de productos. Descuentan stock y entran a la caja de inventario.';
comment on column public.ventas_productos.producto_nombre is
  'Nombre al momento de la venta (foto histórica): si el producto se borra, la venta no pierde su nombre.';
create index if not exists idx_ventas_prod_fecha    on public.ventas_productos(created_at);
create index if not exists idx_ventas_prod_producto on public.ventas_productos(producto_id);
create index if not exists idx_ventas_prod_grupo    on public.ventas_productos(venta_grupo_id);

-- ---------------------------------------------------------------------------
-- 14) nomina_liquidaciones — lo que se le paga a cada trabajador por periodo.
-- ---------------------------------------------------------------------------
create table if not exists public.nomina_liquidaciones (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references public.empleados(id) on delete restrict,
  fecha_inicio    date not null,
  fecha_fin       date not null,
  total_servicios integer not null default 0,
  total_facturado numeric not null default 0,
  porcentaje      numeric not null default 40,
  total_pagar     numeric not null default 0,
  created_at      timestamptz not null default now()
);
comment on table public.nomina_liquidaciones is
  'Liquidaciones de comisión por trabajador y rango de fechas. Las calcula liquidar_nomina().';
create index if not exists idx_nomina_empleado on public.nomina_liquidaciones(empleado_id);
create index if not exists idx_nomina_rango    on public.nomina_liquidaciones(fecha_inicio, fecha_fin);

-- ---------------------------------------------------------------------------
-- 15) gastos_fijos — arriendo y servicios públicos. Si el pago sale de la caja,
--     queda atado a su egreso (caja_movimiento_id) y se descuenta en el cierre.
-- ---------------------------------------------------------------------------
create table if not exists public.gastos_fijos (
  id                 uuid primary key default gen_random_uuid(),
  categoria          text not null,
  concepto           text,
  monto              numeric not null check (monto > 0),
  fecha              date not null default (now() at time zone 'America/Bogota')::date,
  metodo_pago        text check (metodo_pago in ('efectivo','qr','transferencia')),
  caja_movimiento_id uuid references public.caja_movimientos(id) on delete set null,
  created_by         uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now()
);
comment on table public.gastos_fijos is
  'Arriendo y pago de servicios. Cada gasto puede descontarse o no de la caja.';
comment on column public.gastos_fijos.caja_movimiento_id is
  'Egreso de caja de este gasto. NULL = no sale de la caja (se pagó por fuera).';
create index if not exists idx_gastos_fecha on public.gastos_fijos(fecha desc);
create index if not exists idx_gastos_mov   on public.gastos_fijos(caja_movimiento_id);

-- ---------------------------------------------------------------------------
-- SEED — catálogos base: tipos de vehículo y precios de los servicios.
-- Idempotente (ON CONFLICT), se puede volver a correr sin duplicar.
-- ---------------------------------------------------------------------------
insert into public.tipos_vehiculo (codigo, nombre, orden) values
  ('moto',      'Moto',                 1),
  ('moto_alto', 'Moto alto cilindraje', 2),
  ('auto',      'Auto',                 3),
  ('camioneta', 'Camioneta',            4)
on conflict (codigo) do nothing;

insert into public.servicios (categoria, nombre, tipo_vehiculo, precio) values
  ('Autos', 'Sencilla',     'auto', 33000),
  ('Autos', 'Plus',         'auto', 53000),
  ('Autos', 'Máster',       'auto', 65000),
  ('Autos', 'Máster Plus',  'auto', 129000),
  ('Autos', 'Premium',      'auto', 172000),
  ('Autos', 'Premium Plus', 'auto', 285000),
  ('Motos', 'Sencilla',     'moto', 20000),
  ('Motos', 'Desengrasada', 'moto', 27000),
  ('Motos', 'Plus',         'moto', 36000),
  ('Motos', 'Máster',       'moto', 43000),
  ('Motos', 'Máster Plus',  'moto', 53000),
  ('Motos alto cilindraje', 'Sencilla',     'moto_alto', 24000),
  ('Motos alto cilindraje', 'Desengrasada', 'moto_alto', 32000),
  ('Motos alto cilindraje', 'Plus',         'moto_alto', 45000),
  ('Motos alto cilindraje', 'Máster',       'moto_alto', 53000),
  ('Motos alto cilindraje', 'Máster Plus',  'moto_alto', 63000)
on conflict (nombre, tipo_vehiculo) do nothing;

insert into public.servicios (categoria, nombre, descripcion, tipo_vehiculo, precio) values
  ('Otros', 'Aspirada',                       null,                'auto', 23000),
  ('Otros', 'Lavada exterior',                null,                'auto', 23000),
  ('Otros', 'Chasis',                         null,                'auto', 59000),
  ('Otros', 'Motor',                          null,                'auto', 69000),
  ('Otros', 'Gota seca',                      null,                'auto', 90000),
  ('Otros', 'Brillada con máquina',           null,                'auto', 100000),
  ('Otros', 'Full interior sin bajar sillas', null,                'auto', 120000),
  ('Otros', 'Full interior bajando sillas',   null,                'auto', 260000),
  ('Otros', 'Desmanchada + brillada',         null,                'auto', 240000),
  ('Otros', 'Restauración de farolas',        'Precio por farola', 'auto', 80000),
  ('Otros', 'Aspirada',                       null,                'camioneta', 25000),
  ('Otros', 'Lavada exterior',                null,                'camioneta', 25000),
  ('Otros', 'Chasis',                         null,                'camioneta', 69000),
  ('Otros', 'Motor',                          null,                'camioneta', 79000),
  ('Otros', 'Gota seca',                      null,                'camioneta', 130000),
  ('Otros', 'Brillada con máquina',           null,                'camioneta', 140000),
  ('Otros', 'Full interior sin bajar sillas', null,                'camioneta', 150000),
  ('Otros', 'Full interior bajando sillas',   null,                'camioneta', 290000),
  ('Otros', 'Desmanchada + brillada',         null,                'camioneta', 280000),
  ('Otros', 'Restauración de farolas',        'Precio por farola', 'camioneta', 80000)
on conflict (nombre, tipo_vehiculo) do nothing;

-- ---------------------------------------------------------------------------
-- SEGURIDAD — RLS activo en todas las tablas (así lo exige Supabase).
-- Sin políticas nadie entra por la API pública; las políticas reales están en
-- las migraciones 0002 en adelante. Para trabajar desde el panel de Supabase
-- (Table Editor / SQL Editor) esto no estorba: el panel usa la llave de
-- servicio, que pasa por encima de RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.empleados              enable row level security;
alter table public.clientes               enable row level security;
alter table public.vehiculos              enable row level security;
alter table public.tipos_vehiculo         enable row level security;
alter table public.servicios              enable row level security;
alter table public.cierres_caja           enable row level security;
alter table public.ordenes                enable row level security;
alter table public.orden_items            enable row level security;
alter table public.caja_movimientos       enable row level security;
alter table public.productos              enable row level security;
alter table public.inventario_movimientos enable row level security;
alter table public.ventas_productos       enable row level security;
alter table public.nomina_liquidaciones   enable row level security;
alter table public.gastos_fijos           enable row level security;

commit;

-- ============================================================================
-- PASO SIGUIENTE — crear tu usuario (hace falta para los datos de ejemplo,
-- porque casi todas las tablas guardan QUIÉN registró cada cosa):
--   1) Supabase → Authentication → Users → Add user (email + contraseña).
--   2) Copiá su UUID y corré, reemplazando los valores:
--
-- insert into public.profiles (id, nombre, rol)
-- values ('PEGA-AQUI-EL-UUID', 'Tu Nombre', 'super_admin')
-- on conflict (id) do update set rol = 'super_admin', activo = true;
--
--   3) Ahora sí: corré `02_datos_demo.sql`.
-- ============================================================================
