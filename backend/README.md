# Backend — CAR WASH SERVICES (Supabase)

Base de datos Postgres en Supabase: schema, seguridad (RLS) y lógica de negocio.

## Aplicar las migraciones

En **Supabase Dashboard → SQL Editor → New query**, pega y ejecuta cada archivo
de `migrations/` **en orden**:

| # | Archivo | Qué hace |
|---|---------|----------|
| 1 | `0001_schema_inicial.sql` | 11 tablas + seed de 36 servicios + RLS activado (sin policies) |
| 2 | `0002_rls.sql` | `get_rol()`/`is_staff()`, policies por rol, trigger de auto-perfil, realtime |
| 3 | `0003_funciones.sql` | Funciones RPC `SECURITY DEFINER` (ver abajo) |
| 4 | `0004_storage.sql` | Bucket privado `ordenes-fotos` + policies de storage |

Son idempotentes (usan `if not exists` / `on conflict` / `drop policy if exists`),
así que puedes re-ejecutarlas sin romper nada.

## Funciones RPC (lógica sensible en el servidor)

El frontend las llama con `supabase.rpc(nombre, args)`. Nunca se confía en montos
ni IDs del cliente.

| Función | Qué hace |
|---------|----------|
| `crear_orden(...)` | Calcula el total desde `servicios`, crea orden + ítems + ingreso a caja (atómico). Fuerza `empleado_id` al usuario si no es staff. |
| `cerrar_caja(caja)` | Consolida los movimientos abiertos de esa caja en un cierre agrupado por método de pago. Total = ingresos − egresos − nómina. Ignora los `fuera_de_caja`. Solo staff. |
| `crear_movimiento(tipo, concepto, metodo, monto, caja, fecha)` | Alta manual de ingreso/egreso. Si la fecha no es la de hoy (hora Colombia) el movimiento nace `fuera_de_caja`: queda en el historial pero no toca la caja abierta ni el cierre. Solo staff. |
| `editar_movimiento(id, tipo, concepto, metodo, monto, fecha)` | Corrige un movimiento suelto (no cerrado ni de una orden), fecha incluida. Solo staff. |
| `liquidar_nomina(empleado, desde, hasta)` | Suma comisiones del empleado en el rango y crea la liquidación. Solo staff. |
| `avanzar_estado_orden(orden)` | Cambia solo el estado (en_proceso → completado → entregado). |
| `registrar_movimiento_inventario(producto, tipo, cantidad)` | Ajusta el stock de forma atómica + registra el movimiento. Solo staff. |

## Bootstrap del primer super_admin

Está documentado al final de `0001_schema_inicial.sql`. Resumen: crea el usuario en
**Authentication → Add user**, copia su UUID y haz un `update`/`insert` en `profiles`
con `rol = 'super_admin'`. (En este proyecto ya existe `raplome7@gmail.com`.)

## ¿Y la Supabase CLI?

El flujo actual es pegar SQL en el editor. Si más adelante quieres usar la CLI,
renombra `backend/` a `supabase/` (o crea un `supabase/config.toml`) y la CLI
detectará `migrations/`.
