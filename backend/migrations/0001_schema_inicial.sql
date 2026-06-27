-- ============================================================================
-- CAR WASH SERVICES — Migración 0001: Schema inicial + seed de servicios
-- Fase 2 del plan.
-- Pegar en: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- (Las políticas RLS y la función get_rol() se añaden en la Fase 3.)
-- ============================================================================

begin;

-- Extensión para gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) profiles — perfil de usuario (1:1 con auth.users), rol y % de comisión.
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
  'Perfiles de usuario con rol y % de comisión. id = auth.users.id';
-- Política: los usuarios se DESACTIVAN (activo=false), no se borran. Por eso las
-- FKs *_by hacia profiles usan ON DELETE RESTRICT (protegen historial/auditoría).

-- ---------------------------------------------------------------------------
-- 2) clientes
-- ---------------------------------------------------------------------------
create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  created_at timestamptz not null default now()
);
comment on table public.clientes is
  'Clientes del lavadero (opcional por orden; ordenes tiene placa directa).';

-- ---------------------------------------------------------------------------
-- 3) vehiculos
-- ---------------------------------------------------------------------------
create table if not exists public.vehiculos (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  placa      text not null,
  tipo       text not null
               check (tipo in ('moto','moto_alto','auto','camioneta'))
);
comment on table public.vehiculos is
  'Vehículos registrados (placa + tipo). El tipo define los servicios aplicables.';
create index if not exists idx_vehiculos_cliente on public.vehiculos(cliente_id);
create index if not exists idx_vehiculos_placa   on public.vehiculos(placa);

-- ---------------------------------------------------------------------------
-- 4) servicios — catálogo (una fila por servicio + tipo de vehículo).
-- ---------------------------------------------------------------------------
create table if not exists public.servicios (
  id            uuid primary key default gen_random_uuid(),
  categoria     text not null,
  nombre        text not null,
  descripcion   text,
  tipo_vehiculo text not null
                  check (tipo_vehiculo in ('moto','moto_alto','auto','camioneta')),
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
-- 5) cierres_caja — se crea antes de caja_movimientos (FK cierre_id).
-- ---------------------------------------------------------------------------
create table if not exists public.cierres_caja (
  id                  uuid primary key default gen_random_uuid(),
  fecha_apertura      timestamptz,
  fecha_cierre        timestamptz not null default now(),
  total_efectivo      numeric not null default 0,
  total_qr            numeric not null default 0,
  total_transferencia numeric not null default 0,
  total_egresos       numeric not null default 0,
  total_general       numeric not null default 0,
  created_by          uuid not null references public.profiles(id) on delete restrict
);
comment on table public.cierres_caja is
  'Cierres de caja. Los totales los calcula la Edge Function cerrar_caja (Fase 6).';

-- ---------------------------------------------------------------------------
-- 6) ordenes
-- ---------------------------------------------------------------------------
create table if not exists public.ordenes (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references public.clientes(id)  on delete set null,
  vehiculo_id uuid references public.vehiculos(id) on delete set null,
  placa       text,
  estado      text not null default 'en_proceso'
                check (estado in ('en_proceso','completado','entregado')),
  metodo_pago text check (metodo_pago in ('efectivo','qr','transferencia')),
  total       numeric not null default 0 check (total >= 0),
  foto_url    text,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);
comment on table public.ordenes is
  'Órdenes de servicio. total se calcula en el servidor, no se confía en el cliente.';
create index if not exists idx_ordenes_created_by on public.ordenes(created_by);
create index if not exists idx_ordenes_created_at on public.ordenes(created_at);
create index if not exists idx_ordenes_estado     on public.ordenes(estado);
create index if not exists idx_ordenes_placa      on public.ordenes(placa);

-- ---------------------------------------------------------------------------
-- 7) orden_items
-- ---------------------------------------------------------------------------
create table if not exists public.orden_items (
  id                  uuid primary key default gen_random_uuid(),
  orden_id            uuid not null references public.ordenes(id)   on delete cascade,
  servicio_id         uuid not null references public.servicios(id) on delete restrict,
  empleado_id         uuid not null references public.profiles(id) on delete restrict,
  precio              numeric not null check (precio >= 0),
  comision_porcentaje numeric not null default 40
                        check (comision_porcentaje >= 0 and comision_porcentaje <= 100)
);
comment on table public.orden_items is
  'Ítems (servicios) de cada orden. empleado_id define la comisión para nómina.';
create index if not exists idx_orden_items_orden    on public.orden_items(orden_id);
create index if not exists idx_orden_items_empleado on public.orden_items(empleado_id);
create index if not exists idx_orden_items_servicio on public.orden_items(servicio_id);

-- ---------------------------------------------------------------------------
-- 8) caja_movimientos
-- ---------------------------------------------------------------------------
create table if not exists public.caja_movimientos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('ingreso','egreso')),
  concepto    text,
  metodo_pago text check (metodo_pago in ('efectivo','qr','transferencia')),
  monto       numeric not null check (monto >= 0),
  orden_id    uuid references public.ordenes(id)      on delete set null,
  cierre_id   uuid references public.cierres_caja(id) on delete set null,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);
comment on table public.caja_movimientos is
  'Movimientos de caja. cierre_id NULL = aún no cerrado (lo consume cerrar_caja).';
-- Índice parcial: acelera "movimientos abiertos" que usa cerrar_caja.
create index if not exists idx_caja_abiertos   on public.caja_movimientos(created_at)
  where cierre_id is null;
create index if not exists idx_caja_cierre     on public.caja_movimientos(cierre_id);
create index if not exists idx_caja_created_at on public.caja_movimientos(created_at);
create index if not exists idx_caja_created_by on public.caja_movimientos(created_by);
create index if not exists idx_caja_orden      on public.caja_movimientos(orden_id);

-- ---------------------------------------------------------------------------
-- 9) productos
-- ---------------------------------------------------------------------------
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  stock_actual numeric not null default 0,
  stock_minimo numeric not null default 0,
  unidad       text
);
comment on table public.productos is
  'Insumos/productos de inventario con alerta de stock mínimo.';

-- ---------------------------------------------------------------------------
-- 10) inventario_movimientos
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
  'Entradas/salidas de stock. Ajustan stock_actual del producto (en app/Fase 7).';
create index if not exists idx_inv_mov_producto on public.inventario_movimientos(producto_id);

-- ---------------------------------------------------------------------------
-- 11) nomina_liquidaciones
-- ---------------------------------------------------------------------------
create table if not exists public.nomina_liquidaciones (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references public.profiles(id) on delete restrict,
  fecha_inicio    date not null,
  fecha_fin       date not null,
  total_servicios integer not null default 0,
  total_facturado numeric not null default 0,
  porcentaje      numeric not null default 40,
  total_pagar     numeric not null default 0,
  created_at      timestamptz not null default now()
);
comment on table public.nomina_liquidaciones is
  'Liquidaciones de nómina por empleado y rango. Las calcula liquidar_nomina (Fase 6).';
create index if not exists idx_nomina_empleado on public.nomina_liquidaciones(empleado_id);
create index if not exists idx_nomina_rango    on public.nomina_liquidaciones(fecha_inicio, fecha_fin);

-- ============================================================================
-- SEED — Catálogo de servicios (precios reales).
-- Idempotente: ON CONFLICT por la clave natural (nombre, tipo_vehiculo).
-- ============================================================================

-- AUTOS / MOTOS / MOTOS ALTO CILINDRAJE (paquetes de lavado)
insert into public.servicios (categoria, nombre, tipo_vehiculo, precio) values
  -- AUTOS
  ('Autos', 'Sencilla',     'auto', 33000),
  ('Autos', 'Plus',         'auto', 53000),
  ('Autos', 'Máster',       'auto', 65000),
  ('Autos', 'Máster Plus',  'auto', 129000),
  ('Autos', 'Premium',      'auto', 172000),
  ('Autos', 'Premium Plus', 'auto', 285000),
  -- MOTOS
  ('Motos', 'Sencilla',     'moto', 20000),
  ('Motos', 'Desengrasada', 'moto', 27000),
  ('Motos', 'Plus',         'moto', 36000),
  ('Motos', 'Máster',       'moto', 43000),
  ('Motos', 'Máster Plus',  'moto', 53000),
  -- MOTOS ALTO CILINDRAJE
  ('Motos alto cilindraje', 'Sencilla',     'moto_alto', 24000),
  ('Motos alto cilindraje', 'Desengrasada', 'moto_alto', 32000),
  ('Motos alto cilindraje', 'Plus',         'moto_alto', 45000),
  ('Motos alto cilindraje', 'Máster',       'moto_alto', 53000),
  ('Motos alto cilindraje', 'Máster Plus',  'moto_alto', 63000)
on conflict (nombre, tipo_vehiculo) do nothing;

-- OTROS — precio diferenciado por tipo (auto / camioneta)
insert into public.servicios (categoria, nombre, descripcion, tipo_vehiculo, precio) values
  -- auto
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
  -- camioneta
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

-- ============================================================================
-- Seguridad: ACTIVAR RLS en todas las tablas (bloqueo total temporal).
-- Sin políticas, nadie accede vía API hasta la Fase 3 (get_rol() + policies).
-- El seed de arriba corre como owner y NO se ve afectado por RLS.
-- ============================================================================
alter table public.profiles               enable row level security;
alter table public.clientes               enable row level security;
alter table public.vehiculos              enable row level security;
alter table public.servicios              enable row level security;
alter table public.cierres_caja           enable row level security;
alter table public.ordenes                enable row level security;
alter table public.orden_items            enable row level security;
alter table public.caja_movimientos       enable row level security;
alter table public.productos              enable row level security;
alter table public.inventario_movimientos enable row level security;
alter table public.nomina_liquidaciones   enable row level security;

commit;

-- ============================================================================
-- (OPCIONAL) Bootstrap del primer usuario super_admin:
--   1) Crea el usuario en Supabase -> Authentication -> Users -> Add user.
--   2) Copia su UUID y ejecuta (reemplazando los valores):
--
-- insert into public.profiles (id, nombre, rol)
-- values ('PEGA-AQUI-EL-UUID', 'Tu Nombre', 'super_admin')
-- on conflict (id) do update set rol = 'super_admin', activo = true;
-- ============================================================================
