-- ============================================================================
-- CAR WASH SERVICES — Migración 0023: Nómina 100% aparte de la caja
-- El negocio pide que el "Total en caja" solo sume ingresos y reste egresos
-- normales; la NÓMINA NO se descuenta del total (se lleva aparte).
--
-- La nómina se sigue registrando como egreso (concepto 'Nómina: …') en la caja
-- 'principal' para que quede trazada y visible en los movimientos, PERO:
--   - NO entra en total_egresos.
--   - NO se resta de total_general.
--   - Se guarda por separado en la nueva columna cierres_caja.total_nomina.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Columna para el total de nómina consolidado en cada cierre.
-- ---------------------------------------------------------------------------
alter table public.cierres_caja
  add column if not exists total_nomina numeric not null default 0;

-- ---------------------------------------------------------------------------
-- 2) cerrar_caja: separa la nómina de los egresos y del total general.
--    (Nota: coalesce(concepto,'') para que un egreso sin concepto NO se pierda
--     del filtro NOT LIKE.)
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
    select 1 from public.caja_movimientos where cierre_id is null and caja = p_caja
  ) then
    raise exception 'No hay movimientos para cerrar en la caja %', p_caja;
  end if;

  insert into public.cierres_caja (created_by, caja) values (v_uid, p_caja) returning id into v_id;

  with abiertos as (
    update public.caja_movimientos
       set cierre_id = v_id
     where cierre_id is null and caja = p_caja
    returning tipo, concepto, metodo_pago, monto, created_at
  )
  update public.cierres_caja c set
    total_efectivo      = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='efectivo'), 0),
    total_qr            = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='qr'), 0),
    total_transferencia = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='transferencia'), 0),
    -- Egresos NORMALES (nómina excluida).
    total_egresos       = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') not like 'Nómina%'), 0),
    -- Nómina, aparte.
    total_nomina        = coalesce((select sum(monto) from abiertos
                                    where tipo='egreso' and coalesce(concepto,'') like 'Nómina%'), 0),
    -- Total general: ingresos - egresos normales (SIN restar la nómina).
    total_general       = coalesce((select sum(monto) from abiertos where tipo='ingreso'), 0)
                          - coalesce((select sum(monto) from abiertos
                                      where tipo='egreso' and coalesce(concepto,'') not like 'Nómina%'), 0),
    fecha_apertura      = coalesce((select min(created_at) from abiertos), now()),
    fecha_cierre        = now()
  where c.id = v_id
  returning c.* into v_row;

  return v_row;
end;
$$;

grant execute on function public.cerrar_caja(text) to authenticated;

commit;
