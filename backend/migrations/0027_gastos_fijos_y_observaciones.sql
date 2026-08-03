-- ============================================================================
-- CAR WASH SERVICES — Migración 0027: Gastos fijos + observaciones de empleado
-- Dos cosas pedidas por el negocio:
--   1) Tabla `gastos_fijos`: arriendo y pago de servicios (agua, luz, internet…).
--      Es un REGISTRO APARTE: NO toca la caja ni los cierres (el arriendo suele
--      pagarse desde el banco, no del efectivo del local). Solo staff.
--   2) `empleados.observaciones`: notas libres sobre el trabajador.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Gastos fijos (arriendo, servicios públicos y demás pagos recurrentes).
--    `categoria` es texto libre a propósito: la app ofrece una lista
--    (arriendo, agua, luz, gas, internet, telefono, otro) y agrupa por lo que
--    haya guardado, así agregar una categoría nueva no exige migrar.
-- ---------------------------------------------------------------------------
create table if not exists public.gastos_fijos (
  id          uuid primary key default gen_random_uuid(),
  categoria   text not null,
  concepto    text,
  monto       numeric not null check (monto > 0),
  fecha       date not null default (now() at time zone 'America/Bogota')::date,
  metodo_pago text check (metodo_pago in ('efectivo','qr','transferencia')),
  created_by  uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table public.gastos_fijos is
  'Arriendo y pago de servicios. Registro contable aparte: no afecta caja_movimientos ni los cierres.';
comment on column public.gastos_fijos.categoria is
  'arriendo | agua | luz | gas | internet | telefono | otro (texto libre; la app propone la lista).';
comment on column public.gastos_fijos.fecha is 'Día del pago (hora Colombia).';

create index if not exists idx_gastos_fecha on public.gastos_fijos(fecha desc);

-- Solo staff (admin / super_admin): es información de dinero, como la caja.
grant select, insert, update, delete on public.gastos_fijos to authenticated;
alter table public.gastos_fijos enable row level security;

drop policy if exists gastos_all on public.gastos_fijos;
create policy gastos_all on public.gastos_fijos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2) Observaciones del empleado (notas libres: horario, acuerdos, etc.).
-- ---------------------------------------------------------------------------
alter table public.empleados
  add column if not exists observaciones text;

comment on column public.empleados.observaciones is
  'Notas libres sobre el trabajador (no se muestran al cliente).';

commit;
