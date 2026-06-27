-- ============================================================================
-- CAR WASH SERVICES — Migración 0008: Venta de productos del inventario
-- Permite vender productos (chicles, bebidas, etc.): descuenta stock, registra
-- la venta y mete el ingreso a caja, todo atómico.
--   - productos.precio: precio de venta fijo por producto.
--   - ventas_productos: historial de ventas.
--   - vender_producto(): stock-- + venta + ingreso a caja (SECURITY DEFINER).
-- Idempotente.
-- ============================================================================

begin;

-- 1) Precio de venta por producto.
alter table public.productos
  add column if not exists precio numeric not null default 0 check (precio >= 0);
comment on column public.productos.precio is 'Precio de venta unitario del producto.';

-- 2) Historial de ventas de productos (guarda el nombre como snapshot).
create table if not exists public.ventas_productos (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid references public.productos(id) on delete set null,
  producto_nombre text not null,
  cantidad        numeric not null check (cantidad > 0),
  precio_unitario numeric not null check (precio_unitario >= 0),
  total           numeric not null check (total >= 0),
  metodo_pago     text not null check (metodo_pago in ('efectivo','qr','transferencia')),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now()
);
comment on table public.ventas_productos is
  'Ventas de productos del inventario. Cada venta descuenta stock y entra a caja.';
create index if not exists idx_ventas_prod_fecha    on public.ventas_productos(created_at);
create index if not exists idx_ventas_prod_producto on public.ventas_productos(producto_id);

-- Permisos de API + RLS (solo staff, como el resto del inventario/caja).
grant select, insert, update, delete on public.ventas_productos to authenticated;
alter table public.ventas_productos enable row level security;

drop policy if exists ventas_prod_all on public.ventas_productos;
create policy ventas_prod_all on public.ventas_productos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- 3) vender_producto: descuenta stock, registra la venta y el ingreso a caja.
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

  -- Descuento de stock ATÓMICO: bloquea si no alcanza (evita stock negativo).
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

  -- Movimiento de inventario (salida) para el histórico de stock.
  insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
  values (v_prod.id, 'salida', p_cantidad, v_uid);

  -- Ingreso a caja por la venta.
  insert into public.caja_movimientos (tipo, concepto, metodo_pago, monto, created_by)
  values ('ingreso', 'Venta: ' || v_prod.nombre || ' x' || p_cantidad, p_metodo_pago, v_total, v_uid);

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_total);
end;
$$;

grant execute on function public.vender_producto(uuid, numeric, text) to authenticated;

commit;
