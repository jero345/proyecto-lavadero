-- ============================================================================
-- CAR WASH SERVICES — Migración 0035: los gastos fijos pueden DESCONTARSE DE LA
-- CAJA (arriendo, servicios, etc.).
--
-- Pedido del negocio: el arriendo se paga con la plata del local, así que tiene
-- que verse en la caja para poder llevar el control. Hasta ahora `gastos_fijos`
-- era un registro aparte que NO tocaba la caja (mig. 0027).
--
-- Cómo queda: al registrar el gasto se elige si sale de la caja.
--   · Sí sale  → se crea un EGRESO en la caja principal, atado al gasto. Entra
--                en el cierre del día como cualquier otro egreso.
--   · No sale  → queda solo en el registro de gastos, como hasta ahora (útil
--                para lo que se paga desde el banco).
-- El vínculo es `gastos_fijos.caja_movimiento_id`: si está lleno, ese gasto
-- está en la caja. Editar o borrar el gasto mantiene el egreso sincronizado, y
-- editar el movimiento desde Caja actualiza el gasto.
--
--   1) gastos_fijos.caja_movimiento_id
--   2) guardar_gasto_fijo()   — alta y edición (crea/actualiza/borra el egreso)
--   3) eliminar_gasto_fijo()  — borra el gasto y su egreso
--   4) editar_movimiento()    — se re-fija (versión de 0028) + sincroniza el gasto
--
-- Aplicar DESPUÉS de las migraciones 0001–0034. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Vínculo gasto ↔ movimiento de caja.
--    on delete set null: si alguien borra el egreso desde Caja, el gasto queda
--    como "no afecta la caja" en vez de romperse.
-- ---------------------------------------------------------------------------
alter table public.gastos_fijos
  add column if not exists caja_movimiento_id uuid
    references public.caja_movimientos(id) on delete set null;

comment on column public.gastos_fijos.caja_movimiento_id is
  'Egreso de caja de este gasto. Nulo = el gasto no sale de la caja (se pagó por fuera).';
comment on table public.gastos_fijos is
  'Arriendo y pago de servicios. Cada gasto puede descontarse o no de la caja principal.';

create index if not exists idx_gastos_mov on public.gastos_fijos(caja_movimiento_id);

-- ---------------------------------------------------------------------------
-- 2) guardar_gasto_fijo: alta y edición del gasto + su egreso en caja.
--    p_id null = gasto nuevo.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_gasto_fijo(
  p_id          uuid,
  p_categoria   text,
  p_concepto    text,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text,
  p_afecta_caja boolean default false
)
returns public.gastos_fijos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_gasto    public.gastos_fijos;
  v_mov      public.caja_movimientos;
  v_tiene_mov boolean := false;
  v_mov_id   uuid;
  v_fecha    timestamptz;
  v_fuera    boolean;
  v_concepto text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
  end if;

  p_categoria := nullif(btrim(p_categoria), '');
  if p_categoria is null then
    raise exception 'La categoría es obligatoria';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'Monto inválido';
  end if;
  if p_fecha is null then
    raise exception 'La fecha es obligatoria';
  end if;
  p_metodo_pago := nullif(p_metodo_pago, '');
  if p_metodo_pago is not null
     and p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;
  -- Un egreso de caja siempre tiene método de pago (así cuadra el cierre).
  if p_afecta_caja and p_metodo_pago is null then
    raise exception 'Elige el método de pago para descontarlo de la caja';
  end if;

  -- El gasto en sí.
  if p_id is null then
    insert into public.gastos_fijos (categoria, concepto, monto, fecha, metodo_pago, created_by)
    values (p_categoria, nullif(btrim(p_concepto), ''), p_monto, p_fecha, p_metodo_pago, v_uid)
    returning * into v_gasto;
  else
    update public.gastos_fijos
       set categoria   = p_categoria,
           concepto    = nullif(btrim(p_concepto), ''),
           monto       = p_monto,
           fecha       = p_fecha,
           metodo_pago = p_metodo_pago
     where id = p_id
    returning * into v_gasto;
    if not found then
      raise exception 'Gasto no encontrado';
    end if;
  end if;

  if v_gasto.caja_movimiento_id is not null then
    select * into v_mov from public.caja_movimientos where id = v_gasto.caja_movimiento_id;
    v_tiene_mov := found;
  end if;

  -- Si el egreso ya entró en un cierre, no se toca: la plata de ese día ya está
  -- cuadrada. Se permiten cambios que no afectan la caja (concepto, categoría).
  if v_tiene_mov and v_mov.cierre_id is not null then
    if (not p_afecta_caja)
       or p_monto <> v_mov.monto
       or p_metodo_pago is distinct from v_mov.metodo_pago
       or p_fecha <> (v_mov.created_at at time zone 'America/Bogota')::date then
      raise exception 'El egreso de este gasto ya está en un cierre de caja: solo el super admin puede corregirlo desde Caja';
    end if;
    return v_gasto;
  end if;

  if p_afecta_caja then
    -- El movimiento se fecha el día del pago (medianoche, hora Colombia). Si no
    -- es hoy, nace FUERA de la caja abierta: es histórico, no descuadra el día.
    v_fecha := (p_fecha::timestamp at time zone 'America/Bogota');
    v_fuera := (v_fecha at time zone 'America/Bogota')::date
            <> (now()   at time zone 'America/Bogota')::date;
    v_concepto := 'Gasto fijo: ' || p_categoria
               || coalesce(' — ' || nullif(btrim(p_concepto), ''), '');

    if v_tiene_mov then
      update public.caja_movimientos
         set tipo          = 'egreso',
             concepto      = v_concepto,
             metodo_pago   = p_metodo_pago,
             monto         = p_monto,
             caja          = 'principal',
             created_at    = v_fecha,
             fuera_de_caja = v_fuera
       where id = v_mov.id;
    else
      insert into public.caja_movimientos
        (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
      values
        ('egreso', v_concepto, p_metodo_pago, p_monto, 'principal', v_fecha, v_fuera, v_uid)
      returning id into v_mov_id;

      update public.gastos_fijos set caja_movimiento_id = v_mov_id
       where id = v_gasto.id
      returning * into v_gasto;
    end if;
  elsif v_tiene_mov then
    -- Dejó de salir de la caja: se suelta el vínculo y se borra el egreso.
    update public.gastos_fijos set caja_movimiento_id = null
     where id = v_gasto.id
    returning * into v_gasto;
    delete from public.caja_movimientos where id = v_mov.id;
  end if;

  return v_gasto;
end;
$$;

comment on function public.guardar_gasto_fijo(uuid, text, text, numeric, date, text, boolean) is
  'Alta/edición de un gasto fijo. Con p_afecta_caja crea o actualiza su egreso en la caja principal.';

grant execute on function public.guardar_gasto_fijo(uuid, text, text, numeric, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) eliminar_gasto_fijo: borra el gasto y, si lo tiene, su egreso de caja.
-- ---------------------------------------------------------------------------
create or replace function public.eliminar_gasto_fijo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_gasto     public.gastos_fijos;
  v_mov       public.caja_movimientos;
  v_tiene_mov boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere admin o super admin';
  end if;

  select * into v_gasto from public.gastos_fijos where id = p_id;
  if not found then
    raise exception 'Gasto no encontrado';
  end if;

  if v_gasto.caja_movimiento_id is not null then
    select * into v_mov from public.caja_movimientos where id = v_gasto.caja_movimiento_id;
    v_tiene_mov := found;
    if v_tiene_mov and v_mov.cierre_id is not null then
      raise exception 'El egreso de este gasto ya está en un cierre de caja: no se puede eliminar';
    end if;
  end if;

  delete from public.gastos_fijos where id = p_id;

  if v_tiene_mov then
    delete from public.caja_movimientos where id = v_mov.id;
  end if;
end;
$$;

comment on function public.eliminar_gasto_fijo(uuid) is
  'Elimina un gasto fijo y su egreso de caja (si no está cerrado).';

grant execute on function public.eliminar_gasto_fijo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) editar_movimiento: igual que en 0028, más la sincronización del gasto fijo
--    (si el movimiento es el egreso de un gasto, el gasto sigue el cambio).
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

grant execute on function public.editar_movimiento(uuid, text, text, text, numeric, timestamptz) to authenticated;

commit;
