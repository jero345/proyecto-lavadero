-- ============================================================================
-- CAR WASH SERVICES — Migración 0036: los gastos fijos se descuentan en el
-- CIERRE, no en la caja del día.
--
-- Pedido del negocio: el arriendo y los servicios no pueden bajar el "Total en
-- caja" que cuenta el operario al final del turno (esa plata no salió del
-- cajón del día), pero sí tienen que verse y RESTAR en la pestaña de Cierres.
--
-- Cómo queda: el egreso del gasto (concepto 'Gasto fijo: …', lo crea
-- guardar_gasto_fijo en la mig. 0035) se sigue registrando en la caja
-- principal, PERO:
--   · La pantalla de Caja lo deja fuera del total del día (se avisa aparte
--     cuánto se descontará al cerrar).
--   · Al cerrar, se consolida en su propio cajón: cierres_caja.total_gastos.
--   · NO entra en total_egresos (que queda solo con los egresos del día).
--   · SÍ se resta del total_general del cierre — el general es la plata real.
--
-- Mismo criterio que la nómina (mig. 0023/0025), con su propia columna.
--
--   1) cierres_caja.total_gastos
--   2) cerrar_caja()        — separa los gastos fijos en su columna
--   3) recalcular_cierre()  — igual, para cuando se edita un movimiento cerrado
--   4) Backfill de los cierres ya existentes
--
-- Aplicar DESPUÉS de las migraciones 0001–0035. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Columna del total de gastos fijos consolidado en cada cierre.
-- ---------------------------------------------------------------------------
alter table public.cierres_caja
  add column if not exists total_gastos numeric not null default 0;

comment on column public.cierres_caja.total_gastos is
  'Gastos fijos (arriendo, servicios) consolidados en el cierre. No entran en total_egresos, pero sí se restan del total_general.';

-- ---------------------------------------------------------------------------
-- 2) cerrar_caja: tres cajones de egreso — normales, nómina y gastos fijos.
--    El total general sigue siendo ingresos menos TODO lo que salió.
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
    -- Egresos del día (la nómina y los gastos fijos van en sus propias columnas).
    total_egresos       = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso'
                                      and coalesce(concepto,'') not like 'Nómina%'
                                      and coalesce(concepto,'') not like 'Gasto fijo:%'), 0),
    total_nomina        = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') like 'Nómina%'), 0),
    total_gastos        = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') like 'Gasto fijo:%'), 0),
    -- Total real: ingresos menos TODOS los egresos (nómina y gastos incluidos).
    total_general       = coalesce((select sum(monto) from abiertos where tipo='ingreso'), 0)
                          - coalesce((select sum(monto) from abiertos where tipo='egreso'), 0),
    fecha_apertura      = coalesce((select min(created_at) from abiertos), now()),
    fecha_cierre        = now()
  where c.id = v_id
  returning c.* into v_row;

  return v_row;
end;
$$;

comment on function public.cerrar_caja(text) is
  'Cierra la caja indicada. Separa egresos del día, nómina y gastos fijos; el total general los resta a todos.';

grant execute on function public.cerrar_caja(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) recalcular_cierre: mismo desglose (se usa al editar un movimiento que ya
--    estaba dentro de un cierre — mig. 0028). Respeta el total puesto a mano
--    por un super admin (mig. 0029).
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_cierre(p_cierre_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cierres_caja c set
    total_efectivo      = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'ingreso'
                                       and m.metodo_pago = 'efectivo'), 0),
    total_qr            = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'ingreso'
                                       and m.metodo_pago = 'qr'), 0),
    total_transferencia = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'ingreso'
                                       and m.metodo_pago = 'transferencia'), 0),
    total_egresos       = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'egreso'
                                       and coalesce(m.concepto,'') not like 'Nómina%'
                                       and coalesce(m.concepto,'') not like 'Gasto fijo:%'), 0),
    total_nomina        = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'egreso'
                                       and coalesce(m.concepto,'') like 'Nómina%'), 0),
    total_gastos        = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'egreso'
                                       and coalesce(m.concepto,'') like 'Gasto fijo:%'), 0),
    total_general       = case
      when c.total_general_manual then c.total_general
      else coalesce((select sum(m.monto) from public.caja_movimientos m
                      where m.cierre_id = c.id and m.tipo = 'ingreso'), 0)
           - coalesce((select sum(m.monto) from public.caja_movimientos m
                        where m.cierre_id = c.id and m.tipo = 'egreso'), 0)
    end
  where c.id = p_cierre_id;
end;
$$;

comment on function public.recalcular_cierre(uuid) is
  'Recalcula los totales de un cierre desde sus movimientos (egresos, nómina y gastos fijos por separado). No pisa un total general puesto a mano.';

grant execute on function public.recalcular_cierre(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Backfill: los cierres que ya existen pasan sus gastos fijos a la columna
--    nueva y los sacan de total_egresos. El total_general no cambia (ya los
--    restaba), así que ningún cierre viejo se descuadra.
-- ---------------------------------------------------------------------------
update public.cierres_caja c set
  total_gastos  = coalesce((select sum(m.monto) from public.caja_movimientos m
                             where m.cierre_id = c.id and m.tipo = 'egreso'
                               and coalesce(m.concepto,'') like 'Gasto fijo:%'), 0),
  total_egresos = coalesce((select sum(m.monto) from public.caja_movimientos m
                             where m.cierre_id = c.id and m.tipo = 'egreso'
                               and coalesce(m.concepto,'') not like 'Nómina%'
                               and coalesce(m.concepto,'') not like 'Gasto fijo:%'), 0)
where exists (
  select 1 from public.caja_movimientos m
   where m.cierre_id = c.id and m.tipo = 'egreso'
     and coalesce(m.concepto,'') like 'Gasto fijo:%'
);

commit;
