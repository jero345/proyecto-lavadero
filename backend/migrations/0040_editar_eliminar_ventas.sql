-- ============================================================================
-- CAR WASH SERVICES — Migración 0040: editar y eliminar ventas del inventario.
--
-- Pedido del negocio: poder corregir o borrar una venta de productos ya hecha
-- (se vendió de más, se equivocaron de producto o de método de pago).
--
-- Cómo queda (solo super_admin, igual que todo el inventario desde la 0037):
--   1) caja_movimientos.venta_grupo_id — ata el ingreso de la caja de inventario
--      con su venta. Backfill de las ventas viejas por monto + fecha + concepto.
--   2) eliminar_venta(grupo)  — devuelve el stock (queda como ENTRADA en el
--      histórico de inventario), borra las líneas y borra su ingreso de caja.
--   3) editar_venta(grupo, items, método) — devuelve el stock viejo, aplica el
--      nuevo y actualiza el ingreso de caja (monto, método y concepto).
--
-- Si el ingreso ya estaba dentro de un cierre, el cierre se vuelve a calcular
-- (recalcular_cierre, mig. 0028/0036), igual que al editar un movimiento
-- cerrado. Un total general puesto a mano no se pisa (mig. 0029).
--
-- Aplicar DESPUÉS de las migraciones 0001–0039. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Vínculo venta ↔ movimiento de caja.
-- ---------------------------------------------------------------------------
alter table public.caja_movimientos
  add column if not exists venta_grupo_id uuid;

comment on column public.caja_movimientos.venta_grupo_id is
  'Venta de inventario que generó este ingreso (ventas_productos.venta_grupo_id).';

create index if not exists idx_caja_mov_venta on public.caja_movimientos(venta_grupo_id);

-- Backfill: las ventas viejas no guardaban el vínculo. Se empareja cada venta
-- con el ingreso de la caja de inventario que tiene su mismo total y su misma
-- marca de tiempo (vender_productos los crea en la misma transacción).
do $$
declare
  v    record;
  v_id uuid;
begin
  for v in
    select vp.venta_grupo_id      as grupo,
           sum(vp.total)          as total,
           min(vp.created_at)     as creada
      from public.ventas_productos vp
     where vp.venta_grupo_id is not null
     group by vp.venta_grupo_id
  loop
    if exists (select 1 from public.caja_movimientos
                where venta_grupo_id = v.grupo) then
      continue;
    end if;

    select m.id into v_id
      from public.caja_movimientos m
     where m.caja = 'inventario'
       and m.tipo = 'ingreso'
       and m.venta_grupo_id is null
       and m.monto = v.total
       and m.created_at between v.creada - interval '5 seconds'
                            and v.creada + interval '5 seconds'
     order by abs(extract(epoch from (m.created_at - v.creada)))
     limit 1;

    if v_id is not null then
      update public.caja_movimientos set venta_grupo_id = v.grupo where id = v_id;
    end if;
  end loop;
end;
$$;

-- vender_productos: deja el vínculo puesto desde el principio.
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
    (tipo, concepto, metodo_pago, monto, caja, created_by, venta_grupo_id)
  values
    ('ingreso', v_concepto, p_metodo_pago, v_total, 'inventario', v_uid, v_grupo);

  return jsonb_build_object(
    'grupo_id',    v_grupo,
    'total',       v_total,
    'metodo_pago', p_metodo_pago,
    'items',       v_detalle
  );
end;
$$;

grant execute on function public.vender_productos(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) eliminar_venta: deshace la venta completa.
-- ---------------------------------------------------------------------------
create or replace function public.eliminar_venta(p_grupo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_linea  public.ventas_productos;
  v_mov    public.caja_movimientos;
  v_cierre uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_super_admin() then
    raise exception 'No autorizado: el inventario es solo del super admin';
  end if;
  if p_grupo_id is null then
    raise exception 'Venta inválida';
  end if;

  if not exists (select 1 from public.ventas_productos
                  where coalesce(venta_grupo_id, id) = p_grupo_id) then
    raise exception 'Venta no encontrada';
  end if;

  -- Se devuelve el stock de cada línea y queda registrado como ENTRADA en el
  -- histórico de inventario (no se borra el pasado, se corrige).
  for v_linea in
    select * from public.ventas_productos
     where coalesce(venta_grupo_id, id) = p_grupo_id
  loop
    if v_linea.producto_id is not null then
      update public.productos
         set stock_actual = stock_actual + v_linea.cantidad
       where id = v_linea.producto_id;

      insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
      values (v_linea.producto_id, 'entrada', v_linea.cantidad, v_uid);
    end if;
  end loop;

  delete from public.ventas_productos
   where coalesce(venta_grupo_id, id) = p_grupo_id;

  -- El ingreso se va con la venta. Si ya estaba en un cierre, se recalcula.
  select * into v_mov from public.caja_movimientos where venta_grupo_id = p_grupo_id;
  if found then
    v_cierre := v_mov.cierre_id;
    delete from public.caja_movimientos where id = v_mov.id;
    if v_cierre is not null then
      perform public.recalcular_cierre(v_cierre);
    end if;
  end if;
end;
$$;

comment on function public.eliminar_venta(uuid) is
  'Borra una venta de inventario: devuelve el stock, borra sus líneas y su ingreso de caja. Solo super_admin.';

grant execute on function public.eliminar_venta(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) editar_venta: corrige los productos, las cantidades o el método de pago.
--    p_items = [{"producto_id": "...", "cantidad": 2}, ...]
--    Los precios los vuelve a poner el servidor desde `productos`.
-- ---------------------------------------------------------------------------
create or replace function public.editar_venta(
  p_grupo_id    uuid,
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
  v_linea    public.ventas_productos;
  v_item     jsonb;
  v_prod     public.productos;
  v_cant     numeric;
  v_sub      numeric;
  v_total    numeric := 0;
  v_lineas   int := 0;
  v_detalle  jsonb := '[]'::jsonb;
  v_concepto text;
  v_fecha    timestamptz;
  v_mov      public.caja_movimientos;
  v_cierre   uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_super_admin() then
    raise exception 'No autorizado: el inventario es solo del super admin';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no puede quedar sin productos (si quieres, elimínala)';
  end if;
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;

  select min(created_at) into v_fecha from public.ventas_productos
   where coalesce(venta_grupo_id, id) = p_grupo_id;
  if v_fecha is null then
    raise exception 'Venta no encontrada';
  end if;

  -- Primero se devuelve TODO el stock de la venta vieja…
  for v_linea in
    select * from public.ventas_productos
     where coalesce(venta_grupo_id, id) = p_grupo_id
  loop
    if v_linea.producto_id is not null then
      update public.productos
         set stock_actual = stock_actual + v_linea.cantidad
       where id = v_linea.producto_id;

      insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
      values (v_linea.producto_id, 'entrada', v_linea.cantidad, v_uid);
    end if;
  end loop;

  delete from public.ventas_productos
   where coalesce(venta_grupo_id, id) = p_grupo_id;

  -- …y después se aplica la venta corregida, como una venta nueva pero con el
  -- mismo grupo y la fecha original.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cant <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    update public.productos
       set stock_actual = stock_actual - v_cant
     where id = (v_item->>'producto_id')::uuid
       and stock_actual >= v_cant
    returning * into v_prod;
    if not found then
      raise exception 'Stock insuficiente o producto inexistente';
    end if;

    v_sub    := v_prod.precio * v_cant;
    v_total  := v_total + v_sub;
    v_lineas := v_lineas + 1;

    insert into public.ventas_productos
      (producto_id, producto_nombre, cantidad, precio_unitario, total,
       metodo_pago, created_by, venta_grupo_id, created_at)
    values
      (v_prod.id, v_prod.nombre, v_cant, v_prod.precio, v_sub,
       p_metodo_pago, v_uid, p_grupo_id, v_fecha);

    insert into public.inventario_movimientos (producto_id, tipo, cantidad, created_by)
    values (v_prod.id, 'salida', v_cant, v_uid);

    v_detalle := v_detalle || jsonb_build_object(
      'producto_nombre', v_prod.nombre,
      'cantidad',        v_cant,
      'precio_unitario', v_prod.precio,
      'total',           v_sub
    );

    if v_lineas = 1 then
      v_concepto := 'Venta: ' || v_prod.nombre || ' x' || v_cant;
    end if;
  end loop;

  if v_lineas > 1 then
    v_concepto := 'Venta: ' || v_lineas || ' productos';
  end if;

  -- El ingreso de la caja de inventario se ajusta al nuevo total.
  select * into v_mov from public.caja_movimientos where venta_grupo_id = p_grupo_id;
  if found then
    update public.caja_movimientos
       set concepto    = v_concepto,
           metodo_pago = p_metodo_pago,
           monto       = v_total
     where id = v_mov.id;
    v_cierre := v_mov.cierre_id;
    if v_cierre is not null then
      perform public.recalcular_cierre(v_cierre);
    end if;
  else
    -- Venta vieja sin movimiento emparejado: se le crea el suyo, con su fecha.
    insert into public.caja_movimientos
      (tipo, concepto, metodo_pago, monto, caja, created_at, created_by, venta_grupo_id)
    values
      ('ingreso', v_concepto, p_metodo_pago, v_total, 'inventario', v_fecha, v_uid, p_grupo_id);
  end if;

  return jsonb_build_object(
    'grupo_id',    p_grupo_id,
    'total',       v_total,
    'metodo_pago', p_metodo_pago,
    'items',       v_detalle
  );
end;
$$;

comment on function public.editar_venta(uuid, jsonb, text) is
  'Corrige una venta de inventario: repone el stock viejo, aplica el nuevo y ajusta su ingreso de caja. Solo super_admin.';

grant execute on function public.editar_venta(uuid, jsonb, text) to authenticated;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- Ventas sin su ingreso de caja emparejado (lo normal es 0; si alguna
--   -- vieja no se pudo emparejar, al editarla se le crea el movimiento):
--   select count(*) from (
--     select distinct coalesce(venta_grupo_id, id) as g from public.ventas_productos
--   ) v
--   where not exists (select 1 from public.caja_movimientos m
--                      where m.venta_grupo_id = v.g);
-- ============================================================================
