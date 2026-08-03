-- ============================================================================
-- CAR WASH SERVICES — Migración 0029: Total general del cierre editable
-- El negocio necesita corregir a mano el TOTAL GENERAL de un cierre (y solo ese
-- valor). Lo hace únicamente el SUPER ADMIN.
--   1) cierres_caja guarda si el total quedó ajustado a mano, quién y cuándo.
--   2) editar_total_cierre(id, total): fija el total manual. Con total NULL
--      quita el ajuste y vuelve al valor calculado.
--   3) recalcular_cierre respeta el ajuste manual: sigue recalculando el
--      desglose (efectivo/QR/transferencia/egresos/nómina), pero no pisa un
--      total_general puesto a mano.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Marca del ajuste manual.
-- ---------------------------------------------------------------------------
alter table public.cierres_caja
  add column if not exists total_general_manual boolean not null default false;
alter table public.cierres_caja
  add column if not exists total_general_editado_por uuid references public.profiles(id);
alter table public.cierres_caja
  add column if not exists total_general_editado_at timestamptz;

comment on column public.cierres_caja.total_general_manual is
  'true = el total general lo fijó a mano un super admin; el recálculo no lo pisa.';

-- ---------------------------------------------------------------------------
-- 2) editar_total_cierre: solo super admin. p_total NULL = volver al calculado.
-- ---------------------------------------------------------------------------
create or replace function public.editar_total_cierre(
  p_cierre_id uuid,
  p_total     numeric default null
)
returns public.cierres_caja
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.cierres_caja;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_super_admin() then
    raise exception 'No autorizado: solo el super admin puede editar el total del cierre';
  end if;

  if not exists (select 1 from public.cierres_caja where id = p_cierre_id) then
    raise exception 'Cierre no encontrado';
  end if;

  if p_total is null then
    -- Quitar el ajuste: el total vuelve a salir de los movimientos del cierre.
    update public.cierres_caja
       set total_general_manual      = false,
           total_general_editado_por = null,
           total_general_editado_at  = null
     where id = p_cierre_id;

    perform public.recalcular_cierre(p_cierre_id);
  else
    update public.cierres_caja
       set total_general             = p_total,
           total_general_manual      = true,
           total_general_editado_por = v_uid,
           total_general_editado_at  = now()
     where id = p_cierre_id;
  end if;

  select * into v_row from public.cierres_caja where id = p_cierre_id;
  return v_row;
end;
$$;

grant execute on function public.editar_total_cierre(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) recalcular_cierre: no pisa un total general ajustado a mano.
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
                                       and coalesce(m.concepto,'') not like 'Nómina%'), 0),
    total_nomina        = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'egreso'
                                       and coalesce(m.concepto,'') like 'Nómina%'), 0),
    -- El total ajustado a mano se conserva; el resto del desglose sí se recalcula.
    total_general       = case when c.total_general_manual then c.total_general else
                            coalesce((select sum(m.monto) from public.caja_movimientos m
                                       where m.cierre_id = c.id and m.tipo = 'ingreso'), 0)
                            - coalesce((select sum(m.monto) from public.caja_movimientos m
                                         where m.cierre_id = c.id and m.tipo = 'egreso'), 0)
                          end
  where c.id = p_cierre_id;
end;
$$;

grant execute on function public.recalcular_cierre(uuid) to authenticated;

commit;
