-- ============================================================================
-- CAR WASH SERVICES — Migración 0043: buscar clientes en el SERVIDOR.
--
-- Reporte del negocio: "no deja agregar clientes nuevos y no aparecen en la
-- lista al crear una orden".
--
-- Causa: la app traía TODOS los clientes de una y filtraba en el navegador.
-- La API de Supabase corta la respuesta en 1.000 filas, así que al pasar ese
-- número los clientes que quedaban fuera (la lista va ordenada por nombre) no
-- aparecían ni en el POS ni en Clientes. Y como tampoco se veían, se intentaba
-- crearlos otra vez: ahí chocaban con el índice único de placa (mig. 0018) y
-- salía el error "no se pudo crear". Dos síntomas, una sola causa.
--
-- Solución: la búsqueda la hace la base y devuelve solo lo que coincide.
--   1) buscar_clientes(texto, limite)      — placa, nombre o teléfono.
--   2) buscar_cliente_duplicado(placa, nombre, excluir) — el que ya existe.
--
-- Las dos comparan NORMALIZADO (sin espacios ni mayúsculas), igual que los
-- índices únicos de la 0018: así "abc 123" encuentra "ABC123".
--
-- Aplicar DESPUÉS de las migraciones 0001–0042. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Índices para que la búsqueda no recorra toda la tabla.
-- ---------------------------------------------------------------------------
create index if not exists idx_clientes_placa_norm
  on public.clientes (upper(regexp_replace(coalesce(placa, ''), '\s', '', 'g')));
create index if not exists idx_clientes_nombre_norm
  on public.clientes (upper(regexp_replace(nombre, '\s', '', 'g')));

-- ---------------------------------------------------------------------------
-- 1) buscar_clientes: lo que coincide con el texto, de a pocos.
--    Sin texto devuelve los últimos creados (lo más útil en el POS).
-- ---------------------------------------------------------------------------
create or replace function public.buscar_clientes(
  p_q      text default '',
  p_limite int  default 30
)
returns setof public.clientes
language plpgsql
stable
set search_path = public
as $$
declare
  -- Se le quitan espacios, mayúsculas y los comodines de LIKE (%, _, \).
  v_q     text := upper(regexp_replace(coalesce(p_q, ''), '[\s%_\\]', '', 'g'));
  v_lim   int  := greatest(1, least(coalesce(p_limite, 30), 100));
begin
  if v_q = '' then
    return query
      select * from public.clientes
       order by created_at desc
       limit v_lim;
  else
    return query
      select * from public.clientes c
       where upper(regexp_replace(coalesce(c.placa, ''), '\s', '', 'g')) like '%' || v_q || '%'
          or upper(regexp_replace(c.nombre, '\s', '', 'g'))               like '%' || v_q || '%'
          or regexp_replace(coalesce(c.telefono, ''), '\s', '', 'g')      like '%' || v_q || '%'
       order by
         -- Primero los que EMPIEZAN por lo buscado: es lo que uno espera al
         -- teclear una placa.
         case when upper(regexp_replace(coalesce(c.placa, ''), '\s', '', 'g')) like v_q || '%'
              then 0 else 1 end,
         c.nombre
       limit v_lim;
  end if;
end;
$$;

comment on function public.buscar_clientes(text, int) is
  'Busca clientes por placa, nombre o teléfono (normalizado). Sin texto, los últimos creados.';

grant execute on function public.buscar_clientes(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) buscar_cliente_duplicado: el cliente que chocaría con los índices únicos
--    de la 0018. Devuelve 0 o 1 fila. `p_excluir` es para la edición.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_cliente_duplicado(
  p_placa   text,
  p_nombre  text,
  p_excluir uuid default null
)
returns setof public.clientes
language sql
stable
set search_path = public
as $$
  select c.*
    from public.clientes c
   where (p_excluir is null or c.id <> p_excluir)
     and (
       -- Misma placa…
       (
         coalesce(upper(regexp_replace(coalesce(p_placa, ''), '\s', '', 'g')), '') <> ''
         and upper(regexp_replace(coalesce(c.placa, ''), '\s', '', 'g'))
           = upper(regexp_replace(p_placa, '\s', '', 'g'))
       )
       -- …o mismo nombre, pero solo cuando el cliente nuevo no trae placa.
       or (
         coalesce(upper(regexp_replace(coalesce(p_placa, ''), '\s', '', 'g')), '') = ''
         and coalesce(upper(regexp_replace(coalesce(p_nombre, ''), '\s', '', 'g')), '') <> ''
         and upper(regexp_replace(c.nombre, '\s', '', 'g'))
           = upper(regexp_replace(p_nombre, '\s', '', 'g'))
       )
     )
   limit 1;
$$;

comment on function public.buscar_cliente_duplicado(text, text, uuid) is
  'Devuelve el cliente que ya existe con esa placa (o ese nombre si no hay placa). Vacío = se puede crear.';

grant execute on function public.buscar_cliente_duplicado(text, text, uuid) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- ¿Cuántos clientes hay? (si pasan de 1.000, este era el problema)
--   select count(*) from public.clientes;
--
--   -- Buscar una placa, con o sin espacios:
--   select placa, nombre, telefono from public.buscar_clientes('abc 123', 10);
-- ============================================================================
