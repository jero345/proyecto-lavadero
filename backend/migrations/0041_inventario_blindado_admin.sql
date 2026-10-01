-- ============================================================================
-- CAR WASH SERVICES — Migración 0041: el admin tampoco toca el inventario por
-- la puerta de atrás (caja de inventario y ventas).
--
-- Pedido del negocio: solo el super admin puede eliminar productos o modificar
-- ventas. Desde la 0037 el módulo de Inventario ya es suyo (productos, stock,
-- vender), pero quedaban tres rendijas por donde un admin podía tocar el mismo
-- dinero desde la pantalla de Movimientos o la API:
--   · editar un movimiento de la caja de inventario (el ingreso de una venta),
--   · eliminarlo,
--   · crear movimientos en esa caja o cerrarla.
--
-- Cómo queda:
--   1) crear_movimiento   — la caja 'inventario' solo para super_admin.
--   2) editar_movimiento  — ídem; y el ingreso de una VENTA no se edita acá,
--                           se corrige desde Inventario (así la venta y su plata
--                           nunca quedan descuadradas).
--   3) eliminar_movimiento— ídem.
--   4) cerrar_caja        — cerrar la caja de inventario solo super_admin.
--
-- Aplicar DESPUÉS de las migraciones 0001–0040. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) crear_movimiento: igual que en 0028 (el empleado solo egresos de la caja
--    principal), más el candado de la caja de inventario.
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

  -- La caja de inventario es del super admin (mig. 0037/0041).
  if p_caja = 'inventario' and not public.is_super_admin() then
    raise exception 'No autorizado: la caja de inventario es solo del super admin';
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

-- ---------------------------------------------------------------------------
-- 2) editar_movimiento: igual que en 0035 (cerrados y órdenes solo super admin,
--    sincroniza orden y gasto fijo), más los candados del inventario.
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

  -- La plata del inventario es del super admin.
  if v_mov.caja = 'inventario' and not v_super then
    raise exception 'La caja de inventario es solo del super admin';
  end if;
  -- El ingreso de una venta se corrige desde Inventario: allá se ajustan juntos
  -- el stock, las líneas de la venta y la plata.
  if v_mov.venta_grupo_id is not null then
    raise exception 'Este ingreso es de una venta de productos: corrígela desde Inventario';
  end if;

  -- Cerrado o de una orden: solo el super admin (con las sincronizaciones de
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

  -- Si el movimiento es el egreso de un gasto fijo, el gasto sigue el cambio.
  update public.gastos_fijos
     set monto       = p_monto,
         metodo_pago = p_metodo_pago,
         fecha       = (v_mov.created_at at time zone 'America/Bogota')::date
   where caja_movimiento_id = v_mov.id;

  -- Si el movimiento vive en un cierre, ese cierre vuelve a cuadrar.
  if v_mov.cierre_id is not null then
    perform public.recalcular_cierre(v_mov.cierre_id);
  end if;

  return v_mov;
end;
$$;

comment on function public.editar_movimiento(uuid, text, text, text, numeric, timestamptz) is
  'Corrige un movimiento de caja. La caja de inventario es solo del super admin y el ingreso de una venta se corrige desde Inventario.';

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) eliminar_movimiento: mismos candados.
-- ---------------------------------------------------------------------------
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

  if v_mov.caja = 'inventario' and not public.is_super_admin() then
    raise exception 'La caja de inventario es solo del super admin';
  end if;
  if v_mov.venta_grupo_id is not null then
    raise exception 'Este ingreso es de una venta de productos: elimínala desde Inventario';
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

-- ---------------------------------------------------------------------------
-- 4) cerrar_caja: la de inventario la cierra solo el super admin. Todo lo demás
--    es igual a la 0036 (egresos del día, nómina y gastos fijos por separado).
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
  if p_caja = 'inventario' and not public.is_super_admin() then
    raise exception 'No autorizado: la caja de inventario la cierra el super admin';
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
  'Cierra la caja indicada (la de inventario, solo el super admin). Separa egresos del día, nómina y gastos fijos; el total general los resta a todos.';

grant execute on function public.cerrar_caja(text) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla (deben salir las 4 funciones):
--
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('crear_movimiento','editar_movimiento',
--                       'eliminar_movimiento','cerrar_caja')
--     and pg_get_functiondef(p.oid) like '%is_super_admin()%';
-- ============================================================================
