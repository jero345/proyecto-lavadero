-- ============================================================================
-- CAR WASH SERVICES — Migración 0014: Placa en clientes
-- Agrega una columna `placa` opcional a clientes para poder crear un cliente
-- junto con la placa de su vehículo habitual. Al seleccionarlo en el POS, la
-- placa se carga automáticamente en la orden.
-- Idempotente.
-- ============================================================================

begin;

alter table public.clientes
  add column if not exists placa text;

comment on column public.clientes.placa is
  'Placa habitual del cliente (opcional). Se autocompleta en el POS al elegirlo.';

commit;
