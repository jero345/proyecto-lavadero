-- ============================================================================
-- CAR WASH SERVICES — Migración 0033: el empleado vuelve a poder VENDER y
-- MOVER el inventario.
--
-- Reporte del negocio: con un usuario de rol `empleado` el botón "Vender" del
-- Inventario falla con "No autorizado".
--
-- Causa: la migración 0011 había abierto `vender_producto` a cualquier usuario
-- con sesión, pero la 0016 (caja de inventario separada) la volvió a escribir
-- COMPLETA y, sin querer, arrastró de la 0008 el control `if not is_staff()
-- then raise 'No autorizado'`. Como 0016 se aplicó después, esa versión es la
-- que quedó viva en la base. Mismo caso que corrigió la 0031 con cobrar_orden.
--
-- Esta migración deja fijas las versiones abiertas:
--   1) vender_producto            — sin is_staff, conservando el ingreso a la
--                                   CAJA DE INVENTARIO (lógica de 0016).
--   2) registrar_movimiento_inventario — sin is_staff (versión de 0011), por si
--                                   en alguna base quedó viva la de 0003.
--   3) Policies de productos / ventas_productos / inventario_movimientos —
--      se re-fijan abiertas (versión de 0011) por si quedaron las de 0002.
--
-- Lo que NO cambia: la caja y los cierres (incluida la caja de inventario)
-- siguen siendo solo del staff; el precio lo pone siempre el servidor desde
-- `productos`; el stock se descuenta atómicamente y nunca queda negativo.
--
-- Aplicar DESPUÉS de las migraciones 0001–0032. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Policies del inventario: cualquier usuario con sesión.
-- ---------------------------------------------------------------------------
drop policy if exists productos_all on public.productos;
create policy productos_all on public.productos for all to authenticated
  using (true) with check (true);

drop policy if exists ventas_prod_all on public.ventas_productos;
create policy ventas_prod_all on public.ventas_productos for all to authenticated
  using (true) with check (true);

drop policy if exists inv_mov_all on public.inventario_movimientos;
create policy inv_mov_all on public.inventario_movimientos for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2) vender_producto: cualquier usuario con sesión vende.
--    Descuenta stock + registra la venta + movimiento de inventario + ingreso
--    a la caja de INVENTARIO, todo en la misma transacción.
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
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  -- Descuento de stock ATÓMICO: bloquea si no alcanza (evita stock negativo).
  update public.productos
     set stock_actual = stock_actual - p_cantidad
   where id = p_producto_id and stock_actual >= p_cantidad
  returning * into v_prod;
  if not found then
    raise exception 'Stock insuficiente o producto inexistente';
  end if;

  -- El precio SIEMPRE sale de la tabla, nunca del cliente.
  v_total := v_prod.precio * p_cantidad;

  insert into public.ventas_productos
    (producto_id, producto_nombre, cantidad, precio_unitario, total, metodo_pago, created_by)
  values
    (v_prod.id, v_prod.nombre, p_cantidad, v_prod.precio, v_total, p_metodo_pago, v_uid)
  returning id into v_venta_id;

  -- Movimiento de inventario (salida) para el histórico de stock.
  insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
  values (v_prod.id, 'salida', p_cantidad, v_uid);

  -- Ingreso a la CAJA DE INVENTARIO (separada de la principal) — mig. 0016.
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, caja, created_by)
  values ('ingreso', 'Venta: ' || v_prod.nombre || ' x' || p_cantidad,
          p_metodo_pago, v_total, 'inventario', v_uid);

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_total);
end;
$$;

comment on function public.vender_producto(uuid, numeric, text) is
  'Vende un producto: stock-- + venta + ingreso a la caja de inventario. Cualquier usuario con sesión.';

grant execute on function public.vender_producto(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) registrar_movimiento_inventario: entradas/salidas de stock abiertas.
-- ---------------------------------------------------------------------------
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

  -- Update atómico: el saldo lo calcula la BD; la salida bloquea si no alcanza.
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

comment on function public.registrar_movimiento_inventario(uuid, text, numeric) is
  'Entrada/salida de stock atómica + histórico. Cualquier usuario con sesión.';

grant execute on function public.registrar_movimiento_inventario(uuid, text, numeric) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla (debe devolver 0 filas):
--
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('vender_producto','registrar_movimiento_inventario')
--     and pg_get_functiondef(p.oid) like '%is_staff()%';
-- ============================================================================
