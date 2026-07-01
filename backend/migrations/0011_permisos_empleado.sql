-- ============================================================================
-- CAR WASH SERVICES — Migración 0011: Empleado "casi como admin"
-- El empleado (rol empleado) pasa a operar casi todo:
--   * VE todas las órdenes (visibilidad compartida con el staff).
--   * Cobra órdenes, vende productos, mueve/edita inventario, ve ventas.
-- Sigue BLOQUEADO: Caja (movimientos/cierres), Nómina y gestión de
-- empleados(roster)/usuarios. La edición de servicios sigue siendo super_admin.
-- El override del total en crear_orden sigue siendo SOLO staff (anti-fraude).
-- Idempotente.
-- ============================================================================

begin;

-- ----- ordenes / orden_items: TODOS los autenticados ven todo (sync) ---------
drop policy if exists ordenes_select on public.ordenes;
create policy ordenes_select on public.ordenes for select to authenticated
  using (true);

drop policy if exists orden_items_select on public.orden_items;
create policy orden_items_select on public.orden_items for select to authenticated
  using (true);

-- ----- productos: lectura y escritura para todos los autenticados ------------
drop policy if exists productos_all on public.productos;
create policy productos_all on public.productos for all to authenticated
  using (true) with check (true);

-- ----- ventas_productos: todos los autenticados (vender + ver historial) -----
drop policy if exists ventas_prod_all on public.ventas_productos;
create policy ventas_prod_all on public.ventas_productos for all to authenticated
  using (true) with check (true);

-- ----- inventario_movimientos: todos los autenticados ------------------------
drop policy if exists inv_mov_all on public.inventario_movimientos;
create policy inv_mov_all on public.inventario_movimientos for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Funciones: se quita el requisito de is_staff (cualquier autenticado opera).
-- Caja/Nómina siguen protegidas por sus propias policies y funciones.
-- ---------------------------------------------------------------------------

-- cobrar_orden: cualquier autenticado puede cobrar una orden pendiente.
create or replace function public.cobrar_orden(
  p_orden_id    uuid,
  p_metodo_pago text
)
returns public.ordenes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ordenes;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is null or p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', coalesce(p_metodo_pago, '(vacío)');
  end if;

  select * into v_row from public.ordenes where id = p_orden_id;
  if not found then
    raise exception 'Orden no encontrada';
  end if;

  if v_row.metodo_pago is not null then
    raise exception 'La orden ya fue cobrada';
  end if;

  update public.ordenes set metodo_pago = p_metodo_pago
  where id = p_orden_id
  returning * into v_row;

  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, orden_id, created_by)
  values ('ingreso', 'Cobro orden ' || coalesce(v_row.placa,''), p_metodo_pago, v_row.total, p_orden_id, v_uid);

  return v_row;
end;
$$;

grant execute on function public.cobrar_orden(uuid, text) to authenticated;

-- vender_producto: cualquier autenticado puede vender.
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

  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, created_by)
  values ('ingreso', 'Venta: ' || v_prod.nombre || ' x' || p_cantidad, p_metodo_pago, v_total, v_uid);

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_total);
end;
$$;

grant execute on function public.vender_producto(uuid, numeric, text) to authenticated;

-- registrar_movimiento_inventario: cualquier autenticado puede mover stock.
create or replace function public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_tipo        text,
  p_cantidad    numeric
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.productos;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_tipo not in ('entrada','salida') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;

  update public.productos
     set stock_actual = stock_actual
       + (case when p_tipo = 'entrada' then p_cantidad else -p_cantidad end)
   where id = p_producto_id
     and (p_tipo = 'entrada' or stock_actual >= p_cantidad)
  returning * into v_row;

  if not found then
    raise exception 'Stock insuficiente o producto inexistente';
  end if;

  insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
  values (p_producto_id, p_tipo, p_cantidad, v_uid);

  return v_row;
end;
$$;

grant execute on function public.registrar_movimiento_inventario(uuid, text, numeric) to authenticated;

commit;
