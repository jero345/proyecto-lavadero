-- ============================================================================
-- CAR WASH SERVICES — TODO LO PENDIENTE PARA SUPABASE (un solo archivo)
-- Pegá TODO esto en: Supabase → SQL Editor → New query → Run.
--
-- Incluye, en orden:
--   1) 0015 — Backfill de placa en órdenes viejas (con cliente que tiene placa).
--   2) 0018 — Fusiona clientes duplicados + índices únicos (⚠️ DESTRUCTIVO).
--   3) 0019 — Editar/eliminar movimientos para staff (admin + super admin).
--
-- Es SEGURO correrlo aunque ya hayas aplicado alguna parte antes: todo es
-- idempotente (no duplica ni rompe nada si ya estaba hecho).
--
-- ⚠️  El paso 2 borra clientes duplicados (reconectando sus órdenes al que
--     queda). HACÉ UN BACKUP ANTES: Supabase → Database → Backups.
-- ============================================================================


-- ============================================================================
-- 1) 0015 — Backfill de placa en órdenes
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


-- ============================================================================
-- 2) 0018 — Clientes sin duplicados (fusión + índices únicos)  ⚠️ DESTRUCTIVO
-- ============================================================================
begin;

-- 2.1) Mapa duplicado -> sobreviviente (el más antiguo por clave normalizada).
create temp table _dup_map on commit drop as
with norm as (
  select
    id,
    created_at,
    nullif(upper(regexp_replace(coalesce(placa, ''),  '\s', '', 'g')), '') as placa_norm,
    nullif(upper(regexp_replace(coalesce(nombre, ''), '\s', '', 'g')), '') as nombre_norm
  from public.clientes
),
clave as (
  select
    id,
    created_at,
    case
      when placa_norm is not null then 'P:' || placa_norm
      else 'N:' || coalesce(nombre_norm, '')
    end as k
  from norm
),
ranked as (
  select
    id,
    k,
    first_value(id) over (partition by k order by created_at asc, id asc) as keep_id
  from clave
  where k <> 'N:'
)
select id, keep_id from ranked where id <> keep_id;

-- 2.2) Reconectar órdenes y vehículos de los duplicados al sobreviviente.
update public.ordenes o
   set cliente_id = m.keep_id
  from _dup_map m
 where o.cliente_id = m.id;

update public.vehiculos v
   set cliente_id = m.keep_id
  from _dup_map m
 where v.cliente_id = m.id;

-- 2.3) Completar el teléfono del sobreviviente si le faltaba (de un duplicado).
update public.clientes s
   set telefono = d.telefono
  from _dup_map m
  join public.clientes d on d.id = m.id
 where s.id = m.keep_id
   and (s.telefono is null or s.telefono = '')
   and d.telefono is not null and d.telefono <> '';

-- 2.4) Borrar los duplicados sobrantes.
delete from public.clientes c
 using _dup_map m
 where c.id = m.id;

-- 2.5) Índices únicos: impiden crear futuros duplicados a nivel de base.
create unique index if not exists uq_clientes_placa_norm
  on public.clientes (upper(regexp_replace(placa, '\s', '', 'g')))
  where placa is not null and btrim(placa) <> '';

create unique index if not exists uq_clientes_nombre_norm
  on public.clientes (upper(regexp_replace(nombre, '\s', '', 'g')))
  where placa is null or btrim(placa) = '';

commit;


-- ============================================================================
-- 3) 0019 — Editar/eliminar movimientos (staff: admin o super admin)
-- ============================================================================
begin;

-- 3.1) eliminar_movimiento: ahora para cualquier staff (admin o super_admin).
create or replace function public.eliminar_movimiento(p_mov_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mov public.caja_movimientos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
  end if;

  select * into v_mov from public.caja_movimientos where id = p_mov_id;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;

  if v_mov.cierre_id is not null then
    raise exception 'No se puede eliminar: el movimiento ya está en un cierre de caja';
  end if;

  if v_mov.orden_id is not null then
    raise exception 'Este movimiento pertenece a una orden; elimínala desde Órdenes';
  end if;

  delete from public.caja_movimientos where id = p_mov_id;
end;
$$;

grant execute on function public.eliminar_movimiento(uuid) to authenticated;

-- 3.2) editar_movimiento (nuevo): staff corrige un movimiento suelto.
create or replace function public.editar_movimiento(
  p_mov_id      uuid,
  p_tipo        text,
  p_concepto    text,
  p_metodo_pago text,
  p_monto       numeric
)
returns public.caja_movimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mov public.caja_movimientos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
  end if;

  if p_tipo not in ('ingreso','egreso') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;
  if p_monto is null or p_monto < 0 then
    raise exception 'Monto inválido';
  end if;

  select * into v_mov from public.caja_movimientos where id = p_mov_id;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;
  if v_mov.cierre_id is not null then
    raise exception 'No se puede editar: el movimiento ya está en un cierre de caja';
  end if;
  if v_mov.orden_id is not null then
    raise exception 'Este movimiento pertenece a una orden; corrígela desde Órdenes';
  end if;

  update public.caja_movimientos
     set tipo        = p_tipo,
         concepto    = nullif(btrim(p_concepto), ''),
         metodo_pago = p_metodo_pago,
         monto       = p_monto
   where id = p_mov_id
  returning * into v_mov;

  return v_mov;
end;
$$;

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric) to authenticated;

commit;

-- ============================================================================
-- ✅ LISTO. Si no hubo errores en rojo, ya quedó todo aplicado.
-- ============================================================================
