-- ============================================================================
-- CAR WASH SERVICES — ESQUEMA REDUCIDO (versión para sustentar)
--
-- Es el mismo sistema, recortado a 12 tablas para que el modelo entidad-
-- relación se pueda explicar completo en una sustentación. Conserva el hilo
-- entero del negocio y todos los conceptos que se evalúan:
--   · relación uno a muchos                (clientes → ordenes)
--   · relación muchos a muchos con atributos (ordenes ↔ servicios vía orden_items)
--   · relación uno a uno por identificación  (auth.users → profiles)
--   · llave natural / restricción única      (servicios: nombre + tipo_vehiculo)
--   · integridad referencial con las tres reglas de borrado
--     (RESTRICT para el historial, CASCADE para lo dependiente, SET NULL para
--      lo opcional)
--
-- QUÉ SE RECORTÓ respecto de producción (que tiene 15 tablas):
--   · gastos_fijos           — arriendo y servicios públicos
--   · vehiculos              — la orden se queda con la placa directa
--   · inventario_movimientos — historial de entradas/salidas de stock
--   …y algunas columnas de detalle operativo (ajuste manual del cierre,
--   movimientos fuera de caja, foto de la orden).
--
-- Producción NO usa este archivo: allá el esquema real lo arman las
-- migraciones 0001–0036, y la versión completa está en ../completo/01_schema.sql
--
-- CÓMO USARLO
--   1) Supabase → SQL Editor → New query → pegar todo → Run.
--   2) Crear el usuario (ver el final del archivo).
--   3) Correr `02_datos_demo.sql` de esta misma carpeta.
--   4) Ver el diagrama en Database → Schema Visualizer.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) profiles — USUARIOS DEL SISTEMA (los que inician sesión).
--    Uno a uno con auth.users: comparten la llave primaria, así el perfil no
--    puede existir sin cuenta ni duplicarse.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  rol        text not null default 'empleado'
               check (rol in ('super_admin','admin','empleado')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.profiles is
  'Usuarios del sistema (login) con su rol. id = auth.users.id';

-- ---------------------------------------------------------------------------
-- 2) empleados — TRABAJADORES del lavadero. No inician sesión: existen para
--    asignarles el trabajo y pagarles su comisión.
-- ---------------------------------------------------------------------------
create table if not exists public.empleados (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  telefono            text,
  porcentaje_comision numeric not null default 40
                        check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);
comment on table public.empleados is
  'Trabajadores asignables a órdenes (comisión/nómina). NO son usuarios del sistema.';

-- ---------------------------------------------------------------------------
-- 3) clientes — dueños de los vehículos. Todo opcional: en un lavadero entra
--    gente de paso a la que no se le piden los datos.
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

-- ---------------------------------------------------------------------------
-- 4) tipos_vehiculo — catálogo con llave primaria de texto. Agregar un tipo
--    nuevo es insertar una fila, no alterar la tabla.
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_vehiculo (
  codigo text primary key,
  nombre text not null,
  orden  int not null default 0,
  activo boolean not null default true
);
comment on table public.tipos_vehiculo is
  'Catálogo de tipos de vehículo. codigo = valor usado en servicios.tipo_vehiculo.';

-- ---------------------------------------------------------------------------
-- 5) servicios — catálogo de precios. El precio depende del tipo de vehículo,
--    así que hay una fila por servicio Y tipo: (nombre, tipo_vehiculo) es la
--    llave natural.
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

-- ---------------------------------------------------------------------------
-- 6) cierres_caja — el corte del día. Va antes de caja_movimientos porque cada
--    movimiento apunta al cierre que lo consolidó.
-- ---------------------------------------------------------------------------
create table if not exists public.cierres_caja (
  id                  uuid primary key default gen_random_uuid(),
  caja                text not null default 'principal'
                        check (caja in ('principal','inventario')),
  fecha_apertura      timestamptz,
  fecha_cierre        timestamptz not null default now(),
  total_efectivo      numeric not null default 0,
  total_qr            numeric not null default 0,
  total_transferencia numeric not null default 0,
  total_egresos       numeric not null default 0,
  total_nomina        numeric not null default 0,
  total_general       numeric not null default 0,
  created_by          uuid not null references public.profiles(id) on delete restrict
);
comment on table public.cierres_caja is
  'Cierres de caja (principal e inventario, por separado). Los totales quedan guardados, no se recalculan.';

-- ---------------------------------------------------------------------------
-- 7) ordenes — un vehículo que entra a lavarse.
--    metodo_pago NULL = todavía sin cobrar.
-- ---------------------------------------------------------------------------
create table if not exists public.ordenes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid references public.clientes(id) on delete set null,
  placa         text,
  estado        text not null default 'en_proceso'
                  check (estado in ('en_proceso','completado','entregado')),
  metodo_pago   text check (metodo_pago in ('efectivo','qr','transferencia')),
  total         numeric not null default 0 check (total >= 0),
  observaciones text,
  entregado_at  timestamptz,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now()
);
comment on table public.ordenes is
  'Órdenes de servicio. El total lo calcula el servidor: nunca se confía en el cliente.';
comment on column public.ordenes.metodo_pago is
  'NULL = todavía sin cobrar. Al cobrar se llena y nace el ingreso en caja.';
create index if not exists idx_ordenes_created_at on public.ordenes(created_at);
create index if not exists idx_ordenes_estado     on public.ordenes(estado);
create index if not exists idx_ordenes_placa      on public.ordenes(placa);

-- ---------------------------------------------------------------------------
-- 8) orden_items — TABLA ASOCIATIVA. Resuelve el muchos a muchos entre órdenes
--    y servicios, y guarda los atributos que pertenecen a la relación: el
--    precio cobrado, el % de comisión pactado y quién ejecutó el trabajo.
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
  'Servicios de cada orden (tabla asociativa). empleado_id define de quién es la comisión.';
create index if not exists idx_orden_items_orden    on public.orden_items(orden_id);
create index if not exists idx_orden_items_empleado on public.orden_items(empleado_id);

-- ---------------------------------------------------------------------------
-- 9) caja_movimientos — TODO el dinero que entra y sale.
--    cierre_id NULL = todavía en la caja abierta (la llave codifica el estado).
-- ---------------------------------------------------------------------------
create table if not exists public.caja_movimientos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('ingreso','egreso')),
  concepto    text,
  metodo_pago text check (metodo_pago in ('efectivo','qr','transferencia')),
  monto       numeric not null check (monto >= 0),
  caja        text not null default 'principal'
                check (caja in ('principal','inventario')),
  orden_id    uuid references public.ordenes(id)      on delete set null,
  cierre_id   uuid references public.cierres_caja(id) on delete set null,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);
comment on table public.caja_movimientos is
  'Movimientos de caja. cierre_id NULL = aún sin cerrar; al cerrar recibe el id del cierre.';
create index if not exists idx_caja_cierre     on public.caja_movimientos(cierre_id);
create index if not exists idx_caja_created_at on public.caja_movimientos(created_at);
create index if not exists idx_caja_orden      on public.caja_movimientos(orden_id);

-- ---------------------------------------------------------------------------
-- 10) productos — inventario que se vende (ambientadores, microfibras…).
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
-- 11) ventas_productos — una fila por producto vendido. Las líneas de una misma
--     venta comparten venta_grupo_id: así el carrito sale en una sola factura.
--     Guarda el nombre y el precio del momento (foto histórica).
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
comment on column public.ventas_productos.venta_grupo_id is
  'Agrupa las líneas de una misma venta (carrito): una sola factura por grupo.';
create index if not exists idx_ventas_prod_producto on public.ventas_productos(producto_id);
create index if not exists idx_ventas_prod_grupo    on public.ventas_productos(venta_grupo_id);

-- ---------------------------------------------------------------------------
-- 12) nomina_liquidaciones — lo que se le paga a cada trabajador por periodo.
--     Los totales quedan guardados: lo pagado en junio no cambia porque hoy se
--     le suba la comisión.
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
  'Liquidaciones de comisión por trabajador y rango de fechas.';
create index if not exists idx_nomina_empleado on public.nomina_liquidaciones(empleado_id);

-- ---------------------------------------------------------------------------
-- SEED — catálogos base: tipos de vehículo y precios de los servicios.
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
  ('Autos', 'Premium',      'auto', 172000),
  ('Motos', 'Sencilla',     'moto', 20000),
  ('Motos', 'Desengrasada', 'moto', 27000),
  ('Motos', 'Plus',         'moto', 36000),
  ('Motos alto cilindraje', 'Sencilla', 'moto_alto', 24000),
  ('Motos alto cilindraje', 'Plus',     'moto_alto', 45000),
  ('Otros', 'Aspirada',             'auto', 23000),
  ('Otros', 'Lavada exterior',      'auto', 23000),
  ('Otros', 'Brillada con máquina', 'auto', 100000),
  ('Otros', 'Aspirada',             'camioneta', 25000),
  ('Otros', 'Lavada exterior',      'camioneta', 25000),
  ('Otros', 'Brillada con máquina', 'camioneta', 140000)
on conflict (nombre, tipo_vehiculo) do nothing;

-- ---------------------------------------------------------------------------
-- SEGURIDAD — RLS activo en todas las tablas (así lo exige Supabase). Sin
-- políticas nadie entra por la API pública; el panel de Supabase sí funciona,
-- porque usa la llave de servicio.
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.empleados            enable row level security;
alter table public.clientes             enable row level security;
alter table public.tipos_vehiculo       enable row level security;
alter table public.servicios            enable row level security;
alter table public.cierres_caja         enable row level security;
alter table public.ordenes              enable row level security;
alter table public.orden_items          enable row level security;
alter table public.caja_movimientos     enable row level security;
alter table public.productos            enable row level security;
alter table public.ventas_productos     enable row level security;
alter table public.nomina_liquidaciones enable row level security;

commit;

-- ============================================================================
-- PASO SIGUIENTE — crear tu usuario (hace falta para los datos de ejemplo:
-- las tablas guardan QUIÉN registró cada cosa):
--   1) Supabase → Authentication → Users → Add user (email + contraseña).
--   2) Copiá su UUID y corré, reemplazando los valores:
--
-- insert into public.profiles (id, nombre, rol)
-- values ('PEGA-AQUI-EL-UUID', 'Tu Nombre', 'super_admin')
-- on conflict (id) do update set rol = 'super_admin', activo = true;
--
--   3) Ahora sí: corré `02_datos_demo.sql` de esta carpeta.
-- ============================================================================
