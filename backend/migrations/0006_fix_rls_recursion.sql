-- ============================================================================
-- CAR WASH SERVICES — Migración 0006: Arregla recursión infinita en RLS
-- Bug de 0002: la policy de `ordenes` consulta `orden_items` y la de
-- `orden_items` consulta `ordenes` -> "infinite recursion detected in policy".
-- Solo afectaba a EMPLEADOS (staff cortocircuita con is_staff()).
--
-- Fix: mover los chequeos cruzados a funciones SECURITY DEFINER (leen sin
-- disparar RLS, igual que get_rol()), eliminando el ciclo entre ambas tablas.
-- Idempotente.
-- ============================================================================

begin;

-- ¿El usuario actual es empleado asignado en algún ítem de esta orden?
create or replace function public.empleado_en_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orden_items
    where orden_id = p_orden_id and empleado_id = auth.uid()
  );
$$;

-- ¿El usuario actual creó esta orden?
create or replace function public.es_creador_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ordenes
    where id = p_orden_id and created_by = auth.uid()
  );
$$;

grant execute on function public.empleado_en_orden(uuid), public.es_creador_orden(uuid)
  to authenticated;

-- ----- ordenes: ya no consulta orden_items directamente (usa la función) -----
drop policy if exists ordenes_select on public.ordenes;
create policy ordenes_select on public.ordenes for select to authenticated
  using (
    public.is_staff()
    or created_by = auth.uid()
    or public.empleado_en_orden(id)
  );

-- ----- orden_items: ya no consulta ordenes directamente (usa la función) -----
drop policy if exists orden_items_select on public.orden_items;
create policy orden_items_select on public.orden_items for select to authenticated
  using (
    public.is_staff()
    or empleado_id = auth.uid()
    or public.es_creador_orden(orden_id)
  );

commit;
