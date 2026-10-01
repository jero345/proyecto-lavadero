-- ============================================================================
-- CAR WASH SERVICES — Migración 0038: el gasto fijo SIEMPRE descuenta del
-- total general de los cierres de caja.
--
-- Pedido del negocio: un gasto fijo (arriendo, servicios) tiene que restar
-- siempre del "Total general" de Cierres. Hoy no siempre pasa:
--   · si se desmarcaba "Descontar en el cierre de caja", no se creaba el egreso;
--   · si el pago tenía fecha de otro día, el egreso nacía `fuera_de_caja = true`
--     y `cerrar_caja` lo salta, así que no entraba a NINGÚN cierre.
--
-- Cómo queda:
--   1) guardar_gasto_fijo siempre crea/actualiza el egreso en la caja principal
--      (se ignora p_afecta_caja, que se conserva solo por compatibilidad) y
--      siempre con fuera_de_caja = false, sea cual sea la fecha del pago.
--   2) Backfill: los gastos fijos que hoy no tienen egreso lo reciben, y los
--      egresos de gasto fijo que quedaron fuera de caja (y sin cerrar) entran.
--
-- Lo que NO cambia: la pantalla de Caja sigue dejando los gastos fijos fuera
-- del "Total en caja" del turno (esa plata no sale del cajón del día) y los
-- muestra aparte; al cerrar se consolidan en cierres_caja.total_gastos y restan
-- del total general (mig. 0036).
--
-- OJO: por el backfill, los gastos fijos viejos que nunca descontaron entran
-- TODOS en el próximo cierre de la caja principal. En la pantalla de Caja se ve
-- antes de cerrar, en el aviso de gastos fijos pendientes.
--
-- Aplicar DESPUÉS de las migraciones 0001–0037. Idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) guardar_gasto_fijo: el egreso ya no es opcional y nunca queda fuera de caja.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_gasto_fijo(
  p_id          uuid,
  p_categoria   text,
  p_concepto    text,
  p_monto       numeric,
  p_fecha       date,
  p_metodo_pago text,
  p_afecta_caja boolean default true
)
returns public.gastos_fijos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_gasto     public.gastos_fijos;
  v_mov       public.caja_movimientos;
  v_mov_id    uuid;
  v_tiene_mov boolean := false;
  v_concepto  text;
  v_fecha     timestamptz;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_staff() then
    raise exception 'No autorizado: se requiere rol admin o super_admin';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'Monto inválido';
  end if;
  if p_fecha is null then
    raise exception 'La fecha es obligatoria';
  end if;
  if coalesce(btrim(p_categoria), '') = '' then
    raise exception 'La categoría es obligatoria';
  end if;
  -- El gasto SIEMPRE sale de la caja, así que el método de pago es obligatorio.
  if p_metodo_pago not in ('efectivo','qr','transferencia') then
    raise exception 'Elige el método de pago del gasto';
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

  v_concepto := 'Gasto fijo: ' || p_categoria
             || coalesce(' — ' || nullif(btrim(p_concepto), ''), '');
  -- El movimiento se fecha el día del pago (medianoche, hora Colombia), pero
  -- NUNCA nace fuera de caja: tiene que entrar al próximo cierre y restar del
  -- total general.
  v_fecha := (p_fecha::timestamp at time zone 'America/Bogota');

  -- Si el egreso ya entró en un cierre, no se toca: la plata de ese día ya está
  -- cuadrada. Se permiten cambios que no afectan la caja (concepto, categoría).
  if v_tiene_mov and v_mov.cierre_id is not null then
    if p_monto <> v_mov.monto
       or p_metodo_pago is distinct from v_mov.metodo_pago
       or p_fecha <> (v_mov.created_at at time zone 'America/Bogota')::date then
      raise exception 'El egreso de este gasto ya está en un cierre de caja: solo el super admin puede corregirlo desde Caja';
    end if;
    update public.caja_movimientos set concepto = v_concepto where id = v_mov.id;
    return v_gasto;
  end if;

  if v_tiene_mov then
    update public.caja_movimientos
       set tipo          = 'egreso',
           concepto      = v_concepto,
           metodo_pago   = p_metodo_pago,
           monto         = p_monto,
           caja          = 'principal',
           created_at    = v_fecha,
           fuera_de_caja = false
     where id = v_mov.id;
  else
    insert into public.caja_movimientos
      (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
    values
      ('egreso', v_concepto, p_metodo_pago, p_monto, 'principal', v_fecha, false, v_uid)
    returning id into v_mov_id;

    update public.gastos_fijos set caja_movimiento_id = v_mov_id
     where id = v_gasto.id
    returning * into v_gasto;
  end if;

  return v_gasto;
end;
$$;

comment on function public.guardar_gasto_fijo(uuid, text, text, numeric, date, text, boolean) is
  'Alta/edición de un gasto fijo. SIEMPRE crea su egreso en la caja principal, dentro de caja, para que reste del total general del cierre.';

grant execute on function public.guardar_gasto_fijo(uuid, text, text, numeric, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Backfill de lo que ya está registrado.
-- ---------------------------------------------------------------------------

-- 2.a) Los egresos de gasto fijo que quedaron fuera de caja y todavía no están
--      en un cierre: entran, para que el próximo cierre los descuente.
update public.caja_movimientos
   set fuera_de_caja = false
 where fuera_de_caja
   and cierre_id is null
   and tipo = 'egreso'
   and caja = 'principal'
   and coalesce(concepto, '') like 'Gasto fijo:%';

-- 2.b) Los gastos fijos que nunca tuvieron egreso (se guardaron sin descontar)
--      reciben el suyo. Uno por uno, para atar cada gasto a SU movimiento aunque
--      haya dos gastos idénticos. Sin método de pago conocido se asume efectivo.
do $$
declare
  g      public.gastos_fijos;
  v_mov  uuid;
begin
  for g in select * from public.gastos_fijos where caja_movimiento_id is null loop
    insert into public.caja_movimientos
      (tipo, concepto, metodo_pago, monto, caja, created_at, fuera_de_caja, created_by)
    values
      ('egreso',
       'Gasto fijo: ' || g.categoria || coalesce(' — ' || nullif(btrim(g.concepto), ''), ''),
       coalesce(g.metodo_pago, 'efectivo'),
       g.monto,
       'principal',
       (g.fecha::timestamp at time zone 'America/Bogota'),
       false,
       g.created_by)
    returning id into v_mov;

    update public.gastos_fijos set caja_movimiento_id = v_mov where id = g.id;
  end loop;
end;
$$;

commit;

-- ============================================================================
-- Comprobación rápida después de aplicarla:
--
--   -- Debe devolver 0: ningún gasto fijo sin su egreso de caja.
--   select count(*) from public.gastos_fijos where caja_movimiento_id is null;
--
--   -- Lo que descontará el próximo cierre de la caja principal:
--   select coalesce(sum(monto), 0) from public.caja_movimientos
--    where cierre_id is null and not fuera_de_caja
--      and tipo = 'egreso' and concepto like 'Gasto fijo:%';
-- ============================================================================
