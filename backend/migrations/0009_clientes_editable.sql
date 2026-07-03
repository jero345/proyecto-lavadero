-- ============================================================================
-- Todo en Uno · Car Wash Services — Migración 0009: Clientes editables por todos
-- El empleado (además del staff) ya podía crear clientes; ahora también puede
-- EDITARLOS. Solo el borrado sigue restringido a staff (acción destructiva).
-- Idempotente.
-- ============================================================================

begin;

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes for update to authenticated
  using (true) with check (true);

commit;
