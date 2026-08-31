-- ============================================================================
-- CAR WASH SERVICES — Migración 0034: vender VARIOS productos en una sola venta
-- (carrito) y una sola factura.
--
-- Pedido del negocio: hoy hay que vender producto por producto y sale una
-- tirilla por cada uno. Ahora se arma un carrito y se cobra todo junto:
--   · un solo ingreso en la caja de inventario por el total,
--   · una sola tirilla con todos los ítems,
--   · el stock de cada producto se descuenta igual que siempre (atómico).
--
--   1) ventas_productos.venta_grupo_id — agrupa las líneas de una misma venta.
--      Las ventas viejas se rellenan con su propio id (venta de un solo ítem).
--   2) vender_productos(p_items jsonb, p_metodo_pago) — la venta del carrito.
--   3) vender_producto(...) — se conserva como atajo de un solo producto y ahora
--      llama a la nueva función (una sola implementación).
--
-- Aplicar DESPUÉS de las migraciones 0001–0033. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Agrupador de líneas: todas las de una misma venta comparten grupo.
-- ---------------------------------------------------------------------------
alter table public.ventas_productos
  add column if not exists venta_grupo_id uuid;

comment on column public.ventas_productos.venta_grupo_id is
  'Agrupa las líneas de una misma venta (carrito). Una sola tirilla por grupo.';

-- Historial: cada venta vieja es un grupo de una sola línea.
update public.ventas_productos
   set venta_grupo_id = id
 where venta_grupo_id is null;

create index if not exists idx_ventas_prod_grupo
  on public.ventas_productos(venta_grupo_id);

-- ---------------------------------------------------------------------------
-- 2) vender_productos: vende el carrito completo en una sola transacción.
--    p_items = [{"producto_id": "...", "cantidad": 2}, ...]
--    Los PRECIOS los pone el servidor desde `productos`: el cliente solo manda
--    qué y cuánto.
-- ---------------------------------------------------------------------------
create or replace function public.vender_productos(
  p_items       jsonb,
  p_metodo_pago text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_grupo    uuid := gen_random_uuid();
  v_item     jsonb;
  v_prod     public.productos;
  v_cant     numeric;
  v_sub      numeric;
  v_total    numeric := 0;
  v_lineas   int := 0;
  v_detalle  jsonb := '[]'::jsonb;
  v_concepto text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay productos en la venta';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    -- Descuento de stock ATÓMICO: bloquea si no alcanza (evita stock negativo).
    update public.productos
       set stock_actual = stock_actual - v_cant
     where id = (v_item->>'producto_id')::uuid
       and stock_actual >= v_cant
    returning * into v_prod;
    if not found then
      raise exception 'Stock insuficiente o producto inexistente';
    end if;

    v_sub   := v_prod.precio * v_cant;
    v_total := v_total + v_sub;
    v_lineas := v_lineas + 1;

    insert into public.ventas_productos
      (producto_id, producto_nombre, cantidad, precio_unitario, total,
       metodo_pago, created_by, venta_grupo_id)
    values
      (v_prod.id, v_prod.nombre, v_cant, v_prod.precio, v_sub,
       p_metodo_pago, v_uid, v_grupo);

    -- Movimiento de inventario (salida) para el histórico de stock.
    insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
    values (v_prod.id, 'salida', v_cant, v_uid);

    v_detalle := v_detalle || jsonb_build_object(
      'producto_nombre', v_prod.nombre,
      'cantidad',        v_cant,
      'precio_unitario', v_prod.precio,
      'total',           v_sub
    );

    -- El concepto de caja nombra el producto si la venta es de uno solo.
    if v_lineas = 1 then
      v_concepto := 'Venta: ' || v_prod.nombre || ' x' || v_cant;
    end if;
  end loop;

  if v_lineas > 1 then
    v_concepto := 'Venta: ' || v_lineas || ' productos';
  end if;

  -- UN SOLO ingreso a la caja de INVENTARIO por el total de la venta.
  insert into public.caja_movimientos
    (tipo, concepto, metodo_pago, monto, caja, created_by)
  values
    ('ingreso', v_concepto, p_metodo_pago, v_total, 'inventario', v_uid);

  return jsonb_build_object(
    'grupo_id',    v_grupo,
    'total',       v_total,
    'metodo_pago', p_metodo_pago,
    'items',       v_detalle
  );
end;
$$;

comment on function public.vender_productos(jsonb, text) is
  'Vende varios productos de una (carrito): stock-- por ítem + un ingreso a la caja de inventario. Cualquier usuario con sesión.';

grant execute on function public.vender_productos(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) vender_producto: atajo de un solo producto, ahora sobre la nueva función.
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
begin
  return public.vender_productos(
    jsonb_build_array(
      jsonb_build_object('producto_id', p_producto_id, 'cantidad', p_cantidad)
    ),
    p_metodo_pago
  );
end;
$$;

comment on function public.vender_producto(uuid, numeric, text) is
  'Atajo de un solo producto: delega en vender_productos.';

grant execute on function public.vender_producto(uuid, numeric, text) to authenticated;

commit;
