-- ============================================================================
-- CAR WASH SERVICES — Migración 0015: Backfill de placa en órdenes
-- Copia la placa del cliente a las órdenes que quedaron sin placa (creadas
-- antes de conectar la herencia de placa en el POS). Solo toca órdenes con
-- cliente asociado y placa nula/vacía; no pisa placas ya registradas.
-- Idempotente.
-- ============================================================================

begin;

update public.ordenes o
   set placa = c.placa
  from public.clientes c
 where o.cliente_id = c.id
   and c.placa is not null
   and c.placa <> ''
   and (o.placa is null or o.placa = '');

commit;
