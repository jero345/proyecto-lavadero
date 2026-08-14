# CONTEXTO DEL SISTEMA — "Todo en Uno · Car Wash Services"

> Documento de contexto completo del proyecto, pensado para dárselo a un asistente
> de IA (Claude) como punto de partida para reorganizar/evolucionar el sistema.
> Fecha del snapshot: 4 de agosto de 2026. Rama `main`, 43 commits.

---

## 1. Qué es

Sistema **POS + gestión operativa** para un lavadero de autos y motos en **Colombia**
(pesos colombianos, hora de Colombia, WhatsApp como canal de contacto, recibo en
tirilla térmica de 80 mm).

Hoy está **desplegado y en producción para UN solo lavadero**: "Todo en Uno
Automotriz" (NIT 15442040-6, Cll 28 Cr 44-31). El objetivo declarado del dueño es
**venderlo como producto a varios lavaderos** — ver la sección 12, que es el
análisis de brecha para lograrlo.

Cubre el ciclo completo del negocio:

**Orden de servicio → cobro → caja → cierre de caja → nómina por comisiones**,
más inventario con venta de productos, clientes, catálogo de servicios y gastos fijos.

---

## 2. Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript 5.6 |
| Estilos | Tailwind CSS **v3** + shadcn/ui (Radix UI) + lucide-react |
| Estado servidor | TanStack Query v5 |
| Ruteo | React Router DOM v6 |
| Notificaciones | sonner (toasts) |
| Backend / BD | **Supabase**: Postgres + Auth + RLS + Storage + Realtime |
| Lógica de negocio | Funciones Postgres `SECURITY DEFINER` invocadas con `supabase.rpc()` |
| Deploy frontend | Vercel (Root Directory = `frontend`, framework Vite, rewrite SPA) |
| Deploy backend | Supabase (migraciones SQL pegadas a mano en el SQL Editor) |

**No hay servidor propio, ni Edge Functions, ni Docker, ni CLI de Supabase.**
Toda la lógica sensible vive en funciones Postgres. Decisión consciente: evita
infraestructura y mantiene la atomicidad en una sola transacción SQL.

Principio de seguridad central: **nunca se confía en montos ni IDs del cliente**.
Los precios salen siempre de la tabla `servicios` dentro de la función del servidor.

---

## 3. Estructura del repositorio

```
proyecto-lavadero/
├── README.md
├── CONTEXTO.md                  ← este archivo
├── backend/                     # Supabase (no hay código de servidor propio)
│   ├── README.md
│   ├── migrations/              # 29 archivos .sql, se aplican EN ORDEN a mano
│   ├── scripts/                 # 7 scripts destructivos de mantenimiento
│   └── functions/               # vacío (reservado)
└── frontend/
    ├── .env.local               # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (no commiteado)
    ├── .env.example
    ├── vercel.json              # rewrite SPA
    ├── tailwind.config.ts · postcss.config.js · components.json (shadcn)
    ├── index.html               # título con la marca hardcodeada
    └── src/
        ├── main.tsx             # AuthProvider + QueryClientProvider + Router + Toaster
        ├── App.tsx              # rutas (lazy/code-splitting) + guards por rol
        ├── types/database.types.ts   # tipos del schema, ESCRITOS A MANO (471 líneas)
        ├── lib/
        │   ├── supabase.ts      # cliente singleton tipado
        │   ├── negocio.ts       # ⚠️ datos del lavadero HARDCODEADOS (nombre, NIT, dirección)
        │   ├── dominio.ts       # labels ES, iconos/colores por familia de vehículo
        │   ├── format.ts        # COP ($00.000), fechas Colombia, parseo de moneda
        │   ├── recibo.ts        # genera HTML tirilla 80 mm y llama a window.print()
        │   ├── recibo-orden.ts  # puente orden → recibo
        │   ├── contacto.ts      # tel: y wa.me (antepone 57 a celulares de 10 dígitos)
        │   ├── storage.ts       # subida a bucket privado + URLs firmadas
        │   └── utils.ts         # cn() de shadcn
        ├── hooks/
        │   ├── useAuth.tsx      # sesión, profile, rol, isStaff, isSuperAdmin
        │   ├── queries.ts       # useTiposVehiculo, useEmpleados, useServicios,
        │   │                    #  useClientes, useOrdenes, useOrdenesSinCobrar
        │   └── useRealtimeOrdenes.ts  # suscripción Realtime a `ordenes`
        ├── components/
        │   ├── layout/          # AppLayout, Header, Sidebar, nav-items.ts
        │   ├── auth/guards.tsx  # ProtectedRoute, RoleRoute
        │   ├── ui/              # 15 componentes shadcn
        │   ├── Brand.tsx        # ⚠️ marca "Todo en Uno / Car Wash Services" hardcodeada
        │   ├── CobrarOrdenDialog.tsx · AsignarEmpleadoButton.tsx
        │   ├── NuevoMovimientoDialog.tsx
        │   └── EliminarOrdenButton / EliminarMovimientoButton / EliminarLiquidacionButton
        └── pages/               # 13 pantallas
```

### Tamaño del código (sin `components/ui`)

| Archivo | Líneas |
|---|---|
| `pages/Inventario.tsx` | 789 |
| `pages/POS.tsx` | 608 |
| `pages/Cierres.tsx` | 541 |
| `pages/Dashboard.tsx` | 530 |
| `pages/Clientes.tsx` | 516 |
| `pages/Servicios.tsx` | 498 |
| `types/database.types.ts` | 471 |
| `pages/Empleados.tsx` | 458 |
| `pages/Gastos.tsx` | 453 |
| `pages/Movimientos.tsx` | 447 |
| `pages/Caja.tsx` | 310 |
| `pages/Ordenes.tsx` | 259 |
| `pages/Nomina.tsx` | 228 |
| resto (libs, hooks, componentes) | < 220 c/u |

**Patrón dominante:** cada página es un archivo grande y autocontenido — trae sus
propios datos con TanStack Query, define sus diálogos inline y llama a los RPC
directamente. Casi no hay componentes de negocio compartidos.

---

## 4. Modelo de datos (15 tablas, todas con RLS activo)

### Identidad y personas

**`profiles`** — usuarios **con login** (1:1 con `auth.users`).
`id (uuid, FK auth.users) · nombre · rol ('super_admin'|'admin'|'empleado') ·
porcentaje_comision (0–100, default 40) · activo · created_at`
Los usuarios se **desactivan**, no se borran (las FKs `*_by` son `ON DELETE RESTRICT`
para proteger el historial). Un trigger crea el perfil automáticamente al registrarse.

**`empleados`** — roster de trabajadores **SIN login** (migración 0007).
`id · nombre · telefono · porcentaje_comision · activo · observaciones · created_at`
> ⚠️ **Distinción clave del dominio:** `empleados` ≠ `profiles`. Los *empleados* son
> los lavadores que se asignan a las órdenes y cobran comisión pero nunca entran al
> sistema. Los *usuarios del sistema* son `profiles` + Supabase Auth. No existe
> pantalla de "Usuarios": los logins se crean a mano en el dashboard de Supabase.

**`clientes`** — `id · nombre · telefono · placa · created_at`
Índices **únicos** normalizados (mayúsculas, sin espacios) sobre placa y sobre
nombre-sin-placa: la BD rechaza duplicados (migración 0018, que además fusionó los
duplicados históricos). El frontend valida igual y traduce el error `23505`.

### Catálogos

**`tipos_vehiculo`** — `codigo (PK) · nombre · orden · activo · created_at`
Antes eran 4 valores fijos por CHECK; desde la 0021 es un **catálogo dinámico** que
el staff amplía (Buseta, Camión, etc.). Semilla: `moto`, `moto_alto`, `auto`,
`camioneta`. Los iconos/colores se deducen por palabras clave del código y nombre
(`lib/dominio.ts`), así un tipo nuevo hereda el icono de su familia sin tocar código.

**`servicios`** — `id · categoria · nombre · descripcion · tipo_vehiculo (FK) ·
precio · activo`, clave natural única `(nombre, tipo_vehiculo)`.
**Semilla de 36+ servicios con los precios reales de este lavadero** (Sencilla,
Plus, Máster, Máster Plus, Premium, Premium Plus por tipo; más categoría "Otros":
Aspirada, Chasis, Motor, Gota seca, Brillada con máquina, Full interior, etc.).

**`vehiculos`** — `id · cliente_id · placa · tipo`. (Poco usado: la orden lleva
`placa` como texto directo.)

### Operación

**`ordenes`** — `id · cliente_id · vehiculo_id · placa · estado
('en_proceso'|'completado'|'entregado') · metodo_pago ('efectivo'|'qr'|
'transferencia', NULL = sin cobrar) · total · foto_url · observaciones ·
created_by · created_at · entregado_at`
`total` lo calcula el servidor. `entregado_at` se sella al pasar a 'entregado'
(hora de salida del vehículo, sale en el recibo).

**`orden_items`** — `id · orden_id · servicio_id · empleado_id (nullable) ·
precio · comision_porcentaje`.
Los ítems **conservan siempre el precio de catálogo** aunque el total de la orden
se edite: así la comisión no se distorsiona con descuentos.

### Dinero

**`caja_movimientos`** — `id · tipo ('ingreso'|'egreso') · concepto · metodo_pago ·
monto · caja ('principal'|'inventario') · orden_id · cierre_id · **fuera_de_caja** ·
created_by · created_at`
- `cierre_id IS NULL` = movimiento abierto (lo consume `cerrar_caja`).
- **Dos cajas separadas:** `principal` (servicios) e `inventario` (venta de productos).
- `fuera_de_caja = true` cuando se registra con fecha de otro día: queda en el
  historial pero **no toca la caja abierta ni el cierre**.

**`cierres_caja`** — `id · fecha_apertura · fecha_cierre · total_efectivo ·
total_qr · total_transferencia · total_egresos · **total_nomina** · total_general ·
**total_general_manual · total_general_editado_por · total_general_editado_at** ·
caja · created_by`

**`gastos_fijos`** — `id · categoria · concepto · monto · fecha · metodo_pago ·
created_by · created_at`. Arriendo, agua, luz, internet. **Registro aparte: NO toca
la caja ni los cierres** (se pagan desde el banco, no del efectivo del local).

**`nomina_liquidaciones`** — `id · empleado_id · fecha_inicio · fecha_fin ·
total_servicios · total_facturado · porcentaje · total_pagar · created_at`

### Inventario

**`productos`** — `id · nombre · stock_actual · stock_minimo · unidad · precio`
**`ventas_productos`** — `id · producto_id · producto_nombre · cantidad ·
precio_unitario · total · metodo_pago · created_by · created_at`
**`inventario_movimientos`** — `id · producto_id · tipo ('entrada'|'salida') ·
cantidad · created_by · created_at`

### Storage

Bucket **privado** `ordenes-fotos`. Las fotos se muestran con **URLs firmadas**
temporales (`lib/storage.ts`).

---

## 5. Funciones RPC (la lógica de negocio real)

Todas son `SECURITY DEFINER`, atómicas e idempotentes en su definición
(`create or replace`). El frontend las llama con `supabase.rpc(nombre, args)`.

### Helpers de autorización
| Función | Qué hace |
|---|---|
| `get_rol()` | Rol del usuario actual (lee `profiles` sin disparar RLS) |
| `is_staff()` | `admin` o `super_admin` |
| `is_super_admin()` | solo `super_admin` |
| `es_creador_orden(orden)` / `empleado_en_orden(orden)` | rompen la recursión de RLS entre `ordenes` y `orden_items` (fix de la 0006) |
| `handle_new_user()` | trigger: crea el `profile` al registrarse un usuario |

### Órdenes
| Función | Qué hace |
|---|---|
| `crear_orden(servicio_ids[], empleado_id, metodo_pago, placa, cliente_id, vehiculo_id, foto_url, observaciones, total_override)` | Calcula el total desde `servicios`, crea orden + ítems + (si hay método de pago) el ingreso a caja. **Todo atómico.** El empleado es opcional; el `total_override` lo puede usar cualquier usuario con sesión |
| `cobrar_orden(orden_id, metodo_pago)` | Cobra una orden pendiente + genera el ingreso a caja |
| `avanzar_estado_orden(orden_id)` | `en_proceso → completado → entregado`. **Bloquea el avance si la orden no está cobrada.** Sella `entregado_at` al entregar |
| `asignar_empleado_orden(orden_id, empleado_id)` | Asigna el trabajador después de crear la orden |
| `eliminar_orden(orden_id)` | **Solo `super_admin`** (migración 0026). Revierte el ingreso de caja. **Nunca** si la orden ya está en un cierre |

### Caja
| Función | Qué hace |
|---|---|
| `crear_movimiento(tipo, concepto, metodo, monto, caja, fecha)` | Alta manual de ingreso/egreso con fecha libre. Si la fecha no es hoy (hora Colombia) nace `fuera_de_caja` |
| `editar_movimiento(id, tipo, concepto, metodo, monto, fecha)` | Admin: solo movimientos sueltos y sin cerrar. **Super admin: cualquiera, incluso cerrados y de órdenes** — sincroniza la orden y recalcula el cierre afectado (migración 0028) |
| `eliminar_movimiento(id)` | Staff. No borra cerrados ni atados a una orden |
| `cerrar_caja(caja)` | Consolida los movimientos abiertos de **esa** caja agrupando por método de pago. Ignora los `fuera_de_caja`. Solo staff |
| `recalcular_cierre(id)` | Recalcula el desglose de un cierre; **respeta el total_general puesto a mano** |
| `editar_total_cierre(cierre_id, total)` | **Solo super_admin.** Fija el total general a mano; con `NULL` quita el ajuste y vuelve al calculado (migración 0029) |

### Nómina
| Función | Qué hace |
|---|---|
| `liquidar_nomina(empleado_id, desde, hasta, metodo_pago)` | Suma comisiones del rango sobre el **total real de la orden** (incluye el override), crea la liquidación y registra el pago como egreso en la caja `principal` |
| `eliminar_liquidacion(id)` | Staff. Borra también su egreso de nómina **si sigue abierto**; si ya está cerrado, conserva el movimiento (no rompe el cuadre) pero borra la liquidación |
| `detalle_nomina(empleado, desde, hasta)` | Reconstruye qué órdenes y servicios atendió el empleado en el rango (detalle de una liquidación) |
| `empleados_pendientes_liquidar()` | Trabajadores con órdenes de hoy que aún no tienen liquidación de hoy. Alimenta el aviso "falta liquidar" |

### Inventario
| Función | Qué hace |
|---|---|
| `registrar_movimiento_inventario(producto, tipo, cantidad)` | Ajusta stock + registra el movimiento, atómico |
| `vender_producto(producto, cantidad, metodo_pago)` | stock− + venta + ingreso a la caja **`inventario`** |

---

## 6. Roles y matriz de permisos

Tres roles en `profiles.rol`:

| | super_admin | admin | empleado |
|---|:---:|:---:|:---:|
| Dashboard, POS, Órdenes | ✅ | ✅ | ✅ |
| Ver todas las órdenes | ✅ | ✅ | ✅ (desde 0011) |
| Cobrar órdenes / editar el total | ✅ | ✅ | ✅ |
| Clientes (crear/editar) | ✅ | ✅ | ✅ |
| Servicios y tipos de vehículo | ✅ | ✅ | ver |
| Inventario (mover stock, vender) | ✅ | ✅ | ✅ |
| Nómina (liquidar y ver) | ✅ | ✅ | ✅ (desde 0013) |
| **Caja / Cierres / Movimientos** | ✅ | ✅ | ❌ |
| **Gastos fijos** | ✅ | ✅ | ❌ |
| **Empleados (roster)** | ✅ | ✅ | ❌ |
| Editar movimientos **cerrados** | ✅ | ❌ | ❌ |
| Editar el **total general** del cierre | ✅ | ❌ | ❌ |
| **Eliminar órdenes** | ✅ | ❌ | ❌ |

La restricción se aplica **dos veces**: en el frontend (`RoleRoute` en `App.tsx` +
filtro de `roles` en `nav-items.ts`) y en la base (policies RLS + chequeos dentro de
cada función RPC). El frontend solo oculta; la base es la que decide.

> **Migración 0031:** `cobrar_orden`, `avanzar_estado_orden` y `liquidar_nomina`
> quedaron abiertas a cualquier usuario con sesión, y la pantalla de Órdenes muestra
> lo mismo para todos los roles (totales y recibo incluidos). El empleado sigue sin
> acceso a Caja, Cierres, Movimientos, Gastos y gestión del roster.

> **Nota histórica importante:** los permisos del rol `empleado` se fueron abriendo
> mucho a pedido del negocio (migraciones 0010–0013). Hoy el `empleado` es casi un
> admin sin acceso al dinero. Y `eliminar_orden` recorrió el camino inverso:
> super_admin → staff → **cualquiera** (0012) → **solo super_admin** (0026).

---

## 7. Pantallas (13 rutas)

| Ruta | Archivo | Acceso | Qué hace |
|---|---|---|---|
| `/login` | `Login.tsx` | público | Email + contraseña (Supabase Auth) |
| `/` | `Dashboard.tsx` | todos | **Vehículos en proceso** (tiempo real vía Realtime) y **Entregadas sin cobrar**. Avanzar estado, cobrar, asignar empleado, imprimir recibo, eliminar |
| `/pos` | `POS.tsx` | todos | **Nueva orden.** Flujo: tipo de vehículo → servicios (multi-selección) → datos y cobro (cliente con buscador por placa/nombre, placa, observaciones, foto, método de pago, total editable) → empleado (opcional). Optimizado para móvil |
| `/ordenes` | `Ordenes.tsx` | todos | Historial completo con filtros; reimprimir recibo |
| `/caja` | `Caja.tsx` | staff | Caja principal: movimientos sin cerrar, totales por método, botón de cierre, últimos cierres |
| `/cierres` | `Cierres.tsx` | staff | Historial de cierres con desglose; el super admin edita el total general |
| `/movimientos` | `Movimientos.tsx` | staff | Todos los movimientos de ambas cajas; alta manual con fecha libre, editar, eliminar |
| `/gastos` | `Gastos.tsx` | staff | Gastos fijos (arriendo, servicios). Fuera de la caja |
| `/empleados` | `Empleados.tsx` | staff | Roster: alta/edición, % de comisión, fecha de ingreso, observaciones, activar/desactivar |
| `/nomina` | `Nomina.tsx` | todos | Liquidar por empleado y rango de fechas + historial de liquidaciones |
| `/inventario` | `Inventario.tsx` | todos | Productos con stock mínimo, entradas/salidas, **venta de productos con recibo**, ventas recientes y caja de inventario |
| `/clientes` | `Clientes.tsx` | todos | CRUD con validación anti-duplicados, búsqueda por placa, llamada y WhatsApp directos |
| `/servicios` | `Servicios.tsx` | ver todos / editar staff | Catálogo de servicios + catálogo de tipos de vehículo |

**Recibo impreso** (`lib/recibo.ts`, 190 líneas): genera HTML de tirilla de 80 mm y
llama a `window.print()`. Sin librerías. Desde el diálogo del navegador se imprime
en térmica o se guarda como PDF. Muestra hora de **entrada** y **salida**.

---

## 8. Reglas de negocio no obvias

Estas son las que un desarrollador nuevo rompería sin querer:

1. **Una orden no avanza de estado si no está cobrada.** `metodo_pago IS NULL`
   significa "Sin cobrar" y bloquea completar/entregar (migración 0008).
2. **El total de la orden es editable, los ítems no.** Al aplicar un descuento o
   recargo cambia `ordenes.total` y el ingreso de caja, pero `orden_items.precio`
   conserva el precio de catálogo. Sin embargo, **la nómina liquida sobre el total
   real** de la orden, no sobre la suma de los ítems (migración 0022).
3. **La nómina se registra en la caja pero no se resta del total** en los reportes:
   se guarda aparte en `cierres_caja.total_nomina` (0023). *Ojo:* la 0025 revirtió
   parcialmente esto — el total del cierre vuelve a ser ingresos − egresos − nómina.
   **Esta es un área confusa que conviene aclarar con el dueño.**
4. **Dos cajas independientes.** Servicios → `principal`; venta de productos →
   `inventario`. Se cierran por separado.
5. **Los gastos fijos no tocan la caja.** Registro contable aparte.
6. **Nada que ya esté en un cierre se puede borrar.** Es la protección que sobrevivió
   a todos los cambios de permisos. Solo el super admin puede *editar* algo cerrado,
   y en ese caso el sistema recalcula el cierre.
7. **Movimientos con fecha de otro día nacen `fuera_de_caja`:** entran al historial
   pero no a la caja abierta. El "hoy" se evalúa en **hora de Colombia**.
8. **Al liquidar, una orden completa cuenta como 1 servicio** (antes contaba cada
   ítem, migración 0024).
8b. **A cada trabajador se le liquida una sola vez al día** (migración 0032). El tope
   es por día de liquidación en hora Colombia, no por el rango liquidado: se puede
   liquidar cualquier periodo, pero una sola vez por jornada. Evita pagar dos veces
   por darle dos veces al botón.
9. **Clientes únicos por placa normalizada** (mayúsculas, sin espacios ni guiones),
   validado en app y en BD.
10. **Los empleados con historial no se pueden borrar** desde la app (la FK lo
    impide a propósito); hay un script SQL para el caso excepcional.

---

## 9. Configuración y despliegue actuales

```bash
cd frontend
npm install
# .env.local: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build → dist/
```

**Backend:** pegar los 29 archivos de `backend/migrations/` **en orden** en el SQL
Editor de Supabase. Son idempotentes (`if not exists`, `on conflict`,
`drop policy if exists`, `create or replace`).

**Bootstrap del primer super_admin:** manual — crear el usuario en
Authentication → Add user, copiar el UUID y hacer un `insert` en `profiles` con
`rol = 'super_admin'`.

**Scripts de mantenimiento** (`backend/scripts/`, todos destructivos):
`reset_datos.sql` (deja la base en cero conservando servicios y logins),
`reset_transaccional.sql` (borra ventas y caja, conserva maestros),
`reset_caja_nomina.sql`, `borrar_todas_las_ordenes.sql`, `borrar_empleado.sql`,
`borrar_datos_anteriores_a_fecha.sql`, `pendientes_supabase.sql`.

---

## 10. Convenciones del código

- **Todo en español**: nombres de tablas, columnas, funciones, variables,
  comentarios y UI. Mantenerlo así.
- Cada migración empieza con un **bloque de comentario que explica el porqué del
  negocio**, no solo el qué. Es la mejor documentación del sistema.
- Alias de import `@/` → `src/`.
- Formato de moneda propio: `$00.000` (punto de miles, sin decimales) en
  `lib/format.ts`, con su parser inverso.
- Los tipos de `database.types.ts` están **escritos a mano**, no generados.
- Code-splitting con `lazy()` en todas las páginas.

---

## 11. Deuda técnica conocida

1. **Números de migración duplicados**: existen dos `0008`, dos `0009`, dos `0010`,
   dos `0011`, dos `0012` y dos `0015`. El orden real de aplicación es ambiguo.
2. **Migraciones a mano** — sin Supabase CLI, sin control de qué se aplicó dónde.
   Insostenible con más de un cliente.
3. **`database.types.ts` escrito a mano** — puede desincronizarse del schema real.
4. **Páginas de 500–800 líneas** con lógica, datos y diálogos mezclados. Poca
   reutilización entre pantallas.
5. **Sin tests** de ningún tipo, ni CI.
6. **Regla de nómina vs. total de caja contradictoria** entre las migraciones 0023 y
   0025 (ver punto 3 de la sección 8).
7. **`crear_orden` redefinida 7 veces** y `liquidar_nomina` 6 veces a lo largo de las
   migraciones: la versión vigente solo se conoce leyendo la última.
8. Hay un cambio **sin commitear** en `backend/migrations/0024_eliminar_liquidacion.sql`
   (1 línea).
9. **Condición muerta de autorización** (corregida en la migración 0031): desde la
   0007, `orden_items.empleado_id` apunta al roster `empleados` (trabajadores sin
   login), pero `avanzar_estado_orden` y las policies RLS de `ordenes`/`orden_items`
   seguían comparándolo con `auth.uid()`. Son dos universos de ids distintos, así que
   la condición "o es el trabajador asignado" nunca se cumplía. Efecto: un usuario no
   staff solo podía operar las órdenes que él mismo creó.
10. **No hay forma de asignar roles desde la app.** `handle_new_user()` crea todos los
    perfiles con `rol = 'empleado'` y no existe pantalla de Usuarios. Todo usuario
    nuevo nace como empleado hasta que alguien corra un `UPDATE` a mano en SQL. Es la
    causa más probable de los reportes de "no me deja hacer X con la cuenta de admin".

---

## 12. ⚠️ Brecha para venderlo a varios lavaderos

**El sistema es hoy estrictamente mono-inquilino (single-tenant).** No existe ninguna
noción de "lavadero", "sucursal", "organización" ni `tenant_id` en ninguna tabla ni
en ninguna función. Confirmado por búsqueda en todo el repositorio.

Vender el sistema requiere decidir **primero** entre dos caminos:

### Opción A — Un proyecto Supabase + un deploy por cliente (aislamiento físico)
Es lo que ya funciona. Cada lavadero tiene su base, sus datos y su URL.
- ✅ Cero riesgo de fuga de datos entre clientes; cambio mínimo de código.
- ❌ El onboarding es totalmente manual (crear proyecto, correr 29 migraciones,
  crear el super admin por SQL, configurar Vercel). No escala más allá de unos pocos
  clientes, y actualizar a todos significa repetir cada migración N veces.

### Opción B — Multi-tenant real en una sola base
- ✅ Un solo deploy, un solo lugar donde actualizar, onboarding automatizable.
- ❌ Trabajo grande: `tenant_id` en las 15 tablas, reescribir **todas** las policies
  RLS y **todas** las funciones RPC para filtrar por inquilino, migrar los datos
  existentes, y auditar con mucho cuidado que nadie vea datos de otro lavadero.

### Lo que hay que resolver en cualquiera de los dos casos

| # | Brecha | Dónde está hoy |
|---|---|---|
| 1 | **Datos del negocio hardcodeados** (nombre, NIT, dirección, teléfono, pie del recibo) | `frontend/src/lib/negocio.ts` — debe ser una tabla `configuracion` editable desde la app |
| 2 | **Marca hardcodeada** ("Todo en Uno · Car Wash Services", logo de auto+moto) | `components/Brand.tsx`, `index.html`, `package.json`, favicon — necesita logo y nombre por cliente |
| 3 | **Catálogo de servicios sembrado con los precios de este lavadero** | seed de `0001_schema_inicial.sql` — cada cliente necesita su propio tarifario, o un asistente de carga inicial |
| 4 | **No hay pantalla de gestión de usuarios**: los logins se crean a mano en el dashboard de Supabase | hace falta una pantalla de Usuarios (invitar, asignar rol, desactivar) — existió y fue eliminada |
| 5 | **Bootstrap del super_admin es un `INSERT` manual de SQL** | debe ser parte de un flujo de alta de cliente |
| 6 | **Sin onboarding ni autoservicio**: no hay registro, ni creación de cuenta, ni configuración inicial guiada | no existe |
| 7 | **Sin facturación ni control de suscripción**: nada limita el uso, ni marca un cliente como moroso/suspendido | no existe |
| 8 | **Sin panel de superadministrador del producto** para ver los clientes, su uso y su estado | no existe |
| 9 | **Migraciones manuales** — con N clientes hace falta versionado y aplicación automatizada (Supabase CLI) | `backend/migrations/` |
| 10 | **Numeración de migraciones duplicada** — hay que consolidarla antes de automatizar nada | ver deuda técnica |
| 11 | **Sin backups ni exportación de datos por cliente** | no existe |
| 12 | **Moneda, zona horaria y formato fijos a Colombia** | `lib/format.ts` y las funciones SQL que calculan "hoy" en hora Colombia — está bien si solo se vende en Colombia; hay que parametrizar si no |
| 13 | **Sin soporte de múltiples sucursales** para un mismo cliente | no existe |
| 14 | **Sin reportes ni analítica de negocio** más allá de los cierres de caja | argumento de venta que falta |
| 15 | **Sin tests ni CI**: con clientes pagando, un error en producción cuesta dinero real | no existe |

### Recomendación de secuencia

1. **Consolidar** las migraciones duplicadas y adoptar la Supabase CLI.
2. **Externalizar la configuración del negocio** (tabla `configuracion` + pantalla de
   Ajustes): nombre, NIT, dirección, teléfono, logo, pie del recibo. Esto solo ya
   permite vender con la Opción A sin tocar código por cliente.
3. **Construir la pantalla de Usuarios** (crear/invitar, rol, desactivar).
4. **Asistente de configuración inicial** (tipos de vehículo + tarifario) para que un
   lavadero nuevo arranque solo.
5. Recién ahí decidir si el volumen de clientes justifica migrar a multi-tenant real
   (Opción B) o si conviene automatizar el aprovisionamiento de la Opción A.
6. Antes de cobrar: **tests** de las reglas de caja/nómina y un plan de backups.

---

## 13. Preguntas abiertas para el dueño

1. ¿La nómina se resta o no del total de caja? Las migraciones 0023 y 0025 dicen
   cosas distintas.
2. ¿Cada lavadero comprador tendrá su propio dominio/marca, o todos usan la marca
   del producto?
3. ¿Un mismo cliente podría tener varias sucursales?
4. ¿El modelo de cobro será licencia única, mensualidad, o por volumen?
5. ¿Se venderá solo en Colombia (fija COP y hora Colombia) o hay que parametrizarlo?
