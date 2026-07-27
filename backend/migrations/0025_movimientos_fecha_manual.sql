-- ============================================================================
-- CAR WASH SERVICES — Migración 0025: movimientos con fecha manual + total real
-- Cambios:
--   1) caja_movimientos.fuera_de_caja: movimientos registrados con fecha de OTRO
--      día. Quedan en el historial pero NO afectan la caja abierta ni el cierre.
--   2) crear_movimiento(): alta de ingreso/egreso desde la app, con fecha libre.
--      Si la fecha no es la de hoy (hora Colombia) se marca fuera_de_caja.
--   3) editar_movimiento(): ahora también permite corregir la fecha.
--   4) cerrar_caja(): el TOTAL vuelve a ser ingresos − egresos − nómina
--      (la nómina se sigue guardando aparte en total_nomina, solo para el
--      desglose), e ignora los movimientos fuera_de_caja.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Movimientos que no pertenecen a la caja abierta (fecha de otro día).
-- ---------------------------------------------------------------------------
alter table public.caja_movimientos
  add column if not exists fuera_de_caja boolean not null default false;

comment on column public.caja_movimientos.fuera_de_caja is
  'true = registrado con fecha de otro día: queda en el historial pero no entra a la caja abierta ni a los cierres.';

-- Índice parcial: los "abiertos de verdad" son los que consulta la caja.
create index if not exists idx_caja_abiertos_reales
  on public.caja_movimientos(caja, created_at)
  where cierre_id is null and not fuera_de_caja;

-- ---------------------------------------------------------------------------
-- 2) crear_movimiento: alta manual de ingreso/egreso, con fecha opcional.
-- ---------------------------------------------------------------------------
create or replace function public.crear_movimiento(
  p_tipo        text,
  p_concepto    text,
  p_metodo_pago text,
  p_monto       numeric,
  p_caja        text default 'principal',
  p_fecha       timestamptz default null
)
returns public.caja_movimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_fuera boolean;
  v_row   public.caja_movimientos;
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
  if p_monto is null or p_monto <= 0 then
    raise exception 'Monto inválido';
  end if;
  if p_caja not in ('principal','inventario') then
    raise exception 'Caja inválida: %', p_caja;
  end if;

  -- Si la fecha no es la de HOY (hora Colombia), el movimiento es solo
  -- histórico: no toca el total de la caja abierta ni el próximo cierre.
  v_fuera := (v_fecha  at time zone 'America/Bogota')::date
          <> (now()    at time zone 'America/Bogota')::date;

  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
  values
    (p_tipo, nullif(btrim(p_concepto), ''), p_metodo_pago, p_monto, p_caja,
     v_fecha, v_fuera, v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.crear_movimiento(text, text, text, numeric, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) editar_movimiento: agrega la fecha. La firma cambia, se elimina la vieja.
-- ---------------------------------------------------------------------------
drop function if exists public.editar_movimiento(uuid, text, text, text, numeric);

create or replace function public.editar_movimiento(
  p_mov_id      uuid,
  p_tipo        text,
  p_concepto    text,
  p_metodo_pago text,
  p_monto       numeric,
  p_fecha       timestamptz default null
)
returns public.caja_movimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_mov   public.caja_movimientos;
  v_fecha timestamptz;
  v_fuera boolean;
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

  v_fecha := coalesce(p_fecha, v_mov.created_at);
  -- Solo se recalcula si de verdad cambió la fecha; así un movimiento del día
  -- no se sale de la caja por editarle el monto al día siguiente.
  if v_fecha is distinct from v_mov.created_at then
    v_fuera := (v_fecha at time zone 'America/Bogota')::date
            <> (now()   at time zone 'America/Bogota')::date;
  else
    v_fuera := v_mov.fuera_de_caja;
  end if;

  update public.caja_movimientos
     set tipo          = p_tipo,
         concepto      = nullif(btrim(p_concepto), ''),
         metodo_pago   = p_metodo_pago,
         monto         = p_monto,
         created_at    = v_fecha,
         fuera_de_caja = v_fuera
   where id = p_mov_id
  returning * into v_mov;

  return v_mov;
end;
$$;

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) cerrar_caja: total = ingresos − egresos − nómina, ignorando fuera_de_caja.
--    total_nomina se mantiene solo como desglose informativo.
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_caja(p_caja text default 'principal')
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_row public.cierres_caja;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;
  if p_caja not in ('principal','inventario') then
    raise exception 'Caja inválida: %', p_caja;
  end if;

  if not exists (
    select 1 from public.caja_movimientos
     where cierre_id is null and not fuera_de_caja and caja = p_caja
  ) then
    raise exception 'No hay movimientos para cerrar en la caja %', p_caja;
  end if;

  insert into public.cierres_caja (created_by, caja) values (v_uid, p_caja) returning id into v_id;

  with abiertos as (
    update public.caja_movimientos
       set cierre_id = v_id
     where cierre_id is null and not fuera_de_caja and caja = p_caja
    returning tipo, concepto, metodo_pago, monto, created_at
  )
  update public.cierres_caja c set
    total_efectivo      = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='efectivo'), 0),
    total_qr            = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='qr'), 0),
    total_transferencia = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='transferencia'), 0),
    -- Egresos NORMALES (la nómina se desglosa aparte, abajo).
    total_egresos       = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') not like 'Nómina%'), 0),
    total_nomina        = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') like 'Nómina%'), 0),
    -- Total real: ingresos menos TODOS los egresos (nómina incluida).
    total_general       = coalesce((select sum(monto) from abiertos where tipo='ingreso'), 0)
                          - coalesce((select sum(monto) from abiertos where tipo='egreso'), 0),
    fecha_apertura      = coalesce((select min(created_at) from abiertos), now()),
    fecha_cierre        = now()
  where c.id = v_id
  returning c.* into v_row;

  return v_row;
end;
$$;

grant execute on function public.cerrar_caja(text) to authenticated;

commit;
