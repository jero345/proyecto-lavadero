-- ============================================================================
-- CAR WASH SERVICES — Migración 0028: Editar movimientos cerrados + egresos del
-- empleado. Dos cosas pedidas por el negocio:
--   1) El SUPER ADMIN puede editar cualquier movimiento de caja, incluidos los
--      ya CERRADOS y los que vienen de una ORDEN. Para que nada quede
--      descuadrado, al guardar:
--        · si el movimiento es de una orden → se sincroniza la orden
--          (ordenes.total y metodo_pago);
--        · si ya estaba en un cierre → se recalculan los totales de ese cierre.
--      El admin sigue como hasta ahora: solo movimientos sueltos y sin cerrar.
--   2) El EMPLEADO puede registrar EGRESOS de la caja principal (compras del
--      día, etc.). No puede registrar ingresos, ni tocar la caja de inventario,
--      ni ponerle otra fecha: siempre queda con la de hoy.
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) recalcular_cierre: vuelve a sumar los totales de un cierre a partir de sus
--    movimientos. Misma lógica que cerrar_caja (mig. 0025).
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
    total_general       = coalesce((select sum(m.monto) from public.caja_movimientos m
                                     where m.cierre_id = c.id and m.tipo = 'ingreso'), 0)
                          - coalesce((select sum(m.monto) from public.caja_movimientos m
                                       where m.cierre_id = c.id and m.tipo = 'egreso'), 0)
  where c.id = p_cierre_id;
end;
$$;

comment on function public.recalcular_cierre(uuid) is
  'Recalcula los totales de un cierre desde sus movimientos (tras editar uno ya cerrado).';

grant execute on function public.recalcular_cierre(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) editar_movimiento: el super admin puede editar cerrados y de orden.
-- ---------------------------------------------------------------------------
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
  v_super boolean := public.is_super_admin();
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

  -- Cerrado o de una orden: solo el super admin (y con las sincronizaciones de
  -- más abajo, para no dejar el cierre ni la orden descuadrados).
  if v_mov.cierre_id is not null and not v_super then
    raise exception 'El movimiento ya está en un cierre de caja: solo el super admin puede editarlo';
  end if;
  if v_mov.orden_id is not null and not v_super then
    raise exception 'Este movimiento pertenece a una orden; corrígela desde Órdenes';
  end if;

  v_fecha := coalesce(p_fecha, v_mov.created_at);
  -- Solo se recalcula si de verdad cambió la fecha; así un movimiento del día
  -- no se sale de la caja por editarle el monto al día siguiente. Un movimiento
  -- ya cerrado nunca pasa a "fuera de caja": pertenece a su cierre.
  if v_mov.cierre_id is not null then
    v_fuera := v_mov.fuera_de_caja;
  elsif v_fecha is distinct from v_mov.created_at then
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

  -- La orden y su cobro son el mismo dinero: se sincronizan.
  if v_mov.orden_id is not null then
    update public.ordenes
       set total       = p_monto,
           metodo_pago = p_metodo_pago
     where id = v_mov.orden_id;
  end if;

  -- Si el movimiento vive en un cierre, ese cierre vuelve a cuadrar.
  if v_mov.cierre_id is not null then
    perform public.recalcular_cierre(v_mov.cierre_id);
  end if;

  return v_mov;
end;
$$;

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) crear_movimiento: el empleado puede registrar EGRESOS de la caja
--    principal. Ingresos, caja de inventario y fecha libre siguen siendo staff.
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
  v_staff boolean := public.is_staff();
  v_fecha timestamptz;
  v_fuera boolean;
  v_row   public.caja_movimientos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
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

  -- El empleado solo registra egresos de la caja principal, con fecha de hoy.
  if not v_staff then
    if p_tipo <> 'egreso' then
      raise exception 'No autorizado: solo puedes registrar egresos';
    end if;
    if p_caja <> 'principal' then
      raise exception 'No autorizado: solo la caja principal';
    end if;
    p_fecha := null;
  end if;

  v_fecha := coalesce(p_fecha, now());

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

commit;
