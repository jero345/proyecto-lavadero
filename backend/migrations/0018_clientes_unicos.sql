-- ============================================================================
-- CAR WASH SERVICES — Migración 0018: Clientes sin duplicados
-- 1) Fusiona los clientes duplicados que ya existen (misma placa; o mismo
--    nombre cuando no tienen placa), CONSERVANDO el más antiguo y reconectando
--    sus órdenes y vehículos al que queda. Completa el teléfono del que queda
--    si le faltaba. Luego borra los duplicados sobrantes.
-- 2) Crea índices únicos para que la base RECHACE futuros duplicados.
--
-- La normalización (mayúsculas + sin espacios) coincide con la validación del
-- frontend, para que app y base bloqueen exactamente los mismos casos.
--
--  ⚠️  DESTRUCTIVO: borra filas de clientes duplicadas. HAZ UN BACKUP ANTES.
--  Idempotente: si ya no hay duplicados, solo (re)asegura los índices.
--  Ejecutar en: Supabase → SQL Editor → New query → (pegar) → Run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Mapa duplicado -> sobreviviente (el más antiguo por clave normalizada).
--    Clave = 'P:'+placa_norm si tiene placa; si no, 'N:'+nombre_norm.
-- ---------------------------------------------------------------------------
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
  where k <> 'N:'  -- ignora filas sin placa y sin nombre (no deberían existir)
)
select id, keep_id from ranked where id <> keep_id;

-- ---------------------------------------------------------------------------
-- 2) Reconectar órdenes y vehículos de los duplicados al sobreviviente.
-- ---------------------------------------------------------------------------
update public.ordenes o
   set cliente_id = m.keep_id
  from _dup_map m
 where o.cliente_id = m.id;

update public.vehiculos v
   set cliente_id = m.keep_id
  from _dup_map m
 where v.cliente_id = m.id;

-- ---------------------------------------------------------------------------
-- 3) Completar el teléfono del sobreviviente si le faltaba (de un duplicado).
-- ---------------------------------------------------------------------------
update public.clientes s
   set telefono = d.telefono
  from _dup_map m
  join public.clientes d on d.id = m.id
 where s.id = m.keep_id
   and (s.telefono is null or s.telefono = '')
   and d.telefono is not null and d.telefono <> '';

-- ---------------------------------------------------------------------------
-- 4) Borrar los duplicados sobrantes.
-- ---------------------------------------------------------------------------
delete from public.clientes c
 using _dup_map m
 where c.id = m.id;

-- ---------------------------------------------------------------------------
-- 5) Índices únicos: impiden crear futuros duplicados a nivel de base.
--    Placa normalizada (para clientes con placa) y nombre normalizado
--    (para clientes sin placa).
-- ---------------------------------------------------------------------------
create unique index if not exists uq_clientes_placa_norm
  on public.clientes (upper(regexp_replace(placa, '\s', '', 'g')))
  where placa is not null and btrim(placa) <> '';

create unique index if not exists uq_clientes_nombre_norm
  on public.clientes (upper(regexp_replace(nombre, '\s', '', 'g')))
  where placa is null or btrim(placa) = '';

commit;
