-- ============================================================================
-- CAR WASH SERVICES — Migración 0016: Caja de inventario separada + nómina en caja
-- Cambios:
--   1) caja_movimientos y cierres_caja llevan una etiqueta `caja`
--      ('principal' | 'inventario') para separar los flujos de dinero.
--   2) vender_producto: sus ingresos van a la caja 'inventario' (no a la normal).
--   3) liquidar_nomina: recibe método de pago y registra el pago como EGRESO
--      en la caja 'principal' (la nómina afecta la caja).
--   4) cerrar_caja: recibe `p_caja` y cierra SOLO esa caja (cada una por separado).
-- Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Etiqueta de caja en movimientos y cierres.
-- ---------------------------------------------------------------------------
alter table public.caja_movimientos
  add column if not exists caja text not null default 'principal'
    check (caja in ('principal','inventario'));
create index if not exists idx_caja_mov_caja on public.caja_movimientos(caja);

alter table public.cierres_caja
  add column if not exists caja text not null default 'principal'
    check (caja in ('principal','inventario'));

-- ---------------------------------------------------------------------------
-- 2) vender_producto: el ingreso entra a la caja 'inventario'.
-- ---------------------------------------------------------------------------
create or replace function public.vender_producto(
  p_producto_id uuid,
  p_cantidad    numeric,
  p_metodo_pago text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_prod     public.productos;
  v_total    numeric;
  v_venta_id uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  update public.productos
     set stock_actual = stock_actual - p_cantidad
   where id = p_producto_id and stock_actual >= p_cantidad
  returning * into v_prod;
  if not found then
    raise exception 'Stock insuficiente o producto inexistente';
  end if;

  v_total := v_prod.precio * p_cantidad;

  insert into public.ventas_productos
    (producto_id, producto_nombre, cantidad, precio_unitario, total, metodo_pago, created_by)
  values
    (v_prod.id, v_prod.nombre, p_cantidad, v_prod.precio, v_total, p_metodo_pago, v_uid)
  returning id into v_venta_id;

  insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
  values (v_prod.id, 'salida', p_cantidad, v_uid);

  -- Ingreso a la CAJA DE INVENTARIO (separada de la principal).
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
  values ('ingreso', 'Venta: ' || v_prod.nombre || ' x' || p_cantidad,
          p_metodo_pago, v_total, 'inventario', v_uid);

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_total);
end;
$$;

grant execute on function public.vender_producto(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) liquidar_nomina: método de pago + egreso en la caja principal.
--    La firma cambia (agrega p_metodo_pago), por eso se elimina la anterior.
-- ---------------------------------------------------------------------------
drop function if exists public.liquidar_nomina(uuid, date, date);

create or replace function public.liquidar_nomina(
  p_empleado_id  uuid,
  p_fecha_inicio date,
  p_fecha_fin    date,
  p_metodo_pago  text default 'efectivo'
)
returns public.nomina_liquidaciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_nombre     text;
  v_porcentaje numeric;
  v_servicios  int := 0;
  v_facturado  numeric := 0;
  v_pagar      numeric := 0;
  v_row        public.nomina_liquidaciones;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_empleado_id is null or p_fecha_inicio is null or p_fecha_fin is null then
    raise exception 'Parámetros incompletos';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  select nombre, porcentaje_comision into v_nombre, v_porcentaje
  from public.empleados where id = p_empleado_id;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;

  select count(*), coalesce(sum(oi.precio), 0)
    into v_servicios, v_facturado
  from public.orden_items oi
  join public.ordenes o on o.id = oi.orden_id
  where oi.empleado_id = p_empleado_id
    and (o.created_at at time zone 'America/Bogota')::date between p_fecha_inicio and p_fecha_fin;

  v_pagar := round(v_facturado * v_porcentaje / 100.0);

  insert into public.nomina_liquidaciones
    (empleado_id, fecha_inicio, fecha_fin, total_servicios, total_facturado, porcentaje, total_pagar)
  values
    (p_empleado_id, p_fecha_inicio, p_fecha_fin, v_servicios, v_facturado, v_porcentaje, v_pagar)
  returning * into v_row;

  -- El pago de la nómina sale como EGRESO de la caja principal (si hay monto).
  if v_pagar > 0 then
    insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
    values ('egreso',
            'Nómina: ' || v_nombre || ' (' || to_char(p_fecha_inicio,'DD/MM') || '–' || to_char(p_fecha_fin,'DD/MM') || ')',
            p_metodo_pago, v_pagar, 'principal', v_uid);
  end if;

  return v_row;
end;
$$;

grant execute on function public.liquidar_nomina(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) cerrar_caja: cierra SOLO la caja indicada (principal o inventario).
--    La firma cambia (agrega p_caja), por eso se elimina la anterior.
-- ---------------------------------------------------------------------------
drop function if exists public.cerrar_caja();

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
    returning tipo, metodo_pago, monto, created_at
  )
  update public.cierres_caja c set
    total_efectivo      = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='efectivo'), 0),
    total_qr            = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='qr'), 0),
    total_transferencia = coalesce((select sum(monto) from abiertos where tipo='ingreso' and metodo_pago='transferencia'), 0),
    total_egresos       = coalesce((select sum(monto) from abiertos where tipo='egreso'), 0),
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
