-- ============================================================================
-- CAR WASH SERVICES — Migración 0037: inventario SOLO para super_admin,
-- productos que se pueden desactivar o eliminar, y limpieza del campo unidad.
--
-- Pedido del negocio:
--   · El módulo de Inventario (productos, ventas, stock y su caja) queda
--     únicamente en manos del super_admin. Esto REVIERTE la apertura al
--     empleado que hizo la mig. 0033 (vender/mover stock) y la 0011.
--   · Poder DESACTIVAR un producto (deja de venderse pero conserva su historial)
--     y poder ELIMINARLO del todo.
--   · Arreglar el producto que muestra "0 1" en el stock: se le guardó el
--     número "1" en el campo `unidad` (que es un texto: "L", "und", "ml").
--
-- Cómo queda:
--   1) productos.activo — true por defecto. Un producto inactivo no se vende.
--   2) Limpieza: toda `unidad` que sea solo un número pasa a NULL.
--   3) Policies de productos / ventas_productos / inventario_movimientos:
--      solo super_admin (lectura y escritura). Eliminar un producto borra sus
--      movimientos de stock (cascade, mig. 0001) y deja las ventas con
--      producto_id NULL pero con su nombre (set null, mig. 0008): el historial
--      de ventas y de caja NO se pierde.
--   4) vender_productos / vender_producto / registrar_movimiento_inventario:
--      exigen super_admin y rechazan productos inactivos.
--
-- La caja de inventario NO cambia: sigue siendo un flujo aparte
-- (caja = 'inventario', cierre propio) que nunca entra en la caja principal.
--
-- Aplicar DESPUÉS de las migraciones 0001–0036. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Producto activo/inactivo.
-- ---------------------------------------------------------------------------
alter table public.productos
  add column if not exists activo boolean not null default true;

comment on column public.productos.activo is
  'false = producto desactivado: no se vende ni se mueve su stock, pero conserva su historial.';

-- ---------------------------------------------------------------------------
-- 2) Limpieza de `unidad`: es un texto ("L", "und"), no una cantidad.
--    Quita los valores que son solo un número (ej. "1"), que hacían ver el
--    stock como "0 1".
-- ---------------------------------------------------------------------------
update public.productos
   set unidad = null
 where unidad is not null
   and btrim(unidad) ~ '^[0-9]+([.,][0-9]+)?$';

-- ---------------------------------------------------------------------------
-- 3) Policies: el inventario completo es solo del super_admin.
-- ---------------------------------------------------------------------------
drop policy if exists productos_all on public.productos;
create policy productos_all on public.productos for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists ventas_prod_all on public.ventas_productos;
create policy ventas_prod_all on public.ventas_productos for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists inv_mov_all on public.inventario_movimientos;
create policy inv_mov_all on public.inventario_movimientos for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4) vender_productos: solo super_admin y solo productos activos.
--    (Misma lógica de la mig. 0034: precios del servidor, stock atómico y UN
--    ingreso a la caja de INVENTARIO por el total.)
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
  if not public.is_super_admin() then
    raise exception 'No autorizado: el inventario es solo del super admin';
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

    -- Un producto desactivado no se vende, aunque tenga stock.
    if exists (
      select 1 from public.productos
       where id = (v_item->>'producto_id')::uuid and not activo
    ) then
      raise exception 'El producto está desactivado';
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
  -- Nunca toca la caja principal.
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
  'Vende varios productos de una (carrito): stock-- por ítem + un ingreso a la caja de inventario. Solo super_admin.';

grant execute on function public.vender_productos(jsonb, text) to authenticated;

-- vender_producto (atajo de un solo producto) delega en la anterior, así que
-- hereda el control de rol. Se deja igual que en la mig. 0034.

-- ---------------------------------------------------------------------------
-- 5) registrar_movimiento_inventario: solo super_admin y solo productos activos.
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
  if not public.is_super_admin() then
    raise exception 'No autorizado: el inventario es solo del super admin';
  end if;
  if p_tipo not in ('entrada','salida') then
    raise exception 'Tipo inválido: %', p_tipo;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if exists (select 1 from public.productos where id = p_producto_id and not activo) then
    raise exception 'El producto está desactivado';
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
  'Entrada/salida de stock atómica + histórico. Solo super_admin.';

grant execute on function public.registrar_movimiento_inventario(uuid, text, numeric) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- Debe devolver 2 filas (las dos funciones exigen super_admin):
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('vender_productos','registrar_movimiento_inventario')
--     and pg_get_functiondef(p.oid) like '%is_super_admin()%';
--
--   -- Ningún producto debe tener un número en `unidad`:
--   select id, nombre, stock_actual, unidad from public.productos
--   where unidad ~ '^[0-9]';
-- ============================================================================
