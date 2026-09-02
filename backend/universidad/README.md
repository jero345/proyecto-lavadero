# Montar la base de datos en Supabase (presentación)

Tres archivos, en este orden. Cada uno se pega completo en **Supabase → SQL Editor → New query → Run**.

| # | Archivo | Qué hace |
|---|---------|----------|
| 0 | `00_borrar_tablas_de_prueba.sql` | Borra el esquema del primer intento (`ventas`, `venta_items`, y `productos`/`clientes` solo si son las de prueba). Si no encuentra ese esquema, aborta sin tocar nada. |
| 1 | `01_schema_completo.sql` | Crea las **15 tablas** del proyecto con sus llaves, restricciones, índices y comentarios, más el catálogo de servicios y tipos de vehículo. |
| 2 | `02_datos_demo.sql` | Llena la base con un día de operación de ejemplo (órdenes, caja, ventas, nómina, cierre). |

Entre el paso 1 y el 2 hay que **crear el usuario**: Authentication → Users → Add user, y después

```sql
insert into public.profiles (id, nombre, rol)
values ('EL-UUID-DEL-USUARIO', 'Tu Nombre', 'super_admin');
```

Casi todas las tablas guardan *quién* registró cada cosa (`created_by`), por eso hace falta al menos un perfil antes de sembrar datos.

Para ver el diagrama ya montado: **Database → Schema Visualizer**.

> Estos archivos crean las **tablas**. La lógica de negocio (funciones `crear_orden`, `cobrar_orden`, `cerrar_caja`, `liquidar_nomina`…) y las políticas RLS están en `backend/migrations/0002` → `0036`. Si querés la aplicación funcionando de verdad contra esta base, corré esas migraciones en orden en vez de este esquema consolidado.

---

## Modelo entidad-relación

```mermaid
erDiagram
    PROFILES ||--o{ ORDENES : registra
    PROFILES ||--o{ CAJA_MOVIMIENTOS : registra
    PROFILES ||--o{ CIERRES_CAJA : cierra
    PROFILES ||--o{ VENTAS_PRODUCTOS : registra
    PROFILES ||--o{ INVENTARIO_MOVIMIENTOS : registra
    PROFILES ||--o{ GASTOS_FIJOS : registra

    CLIENTES ||--o{ VEHICULOS : tiene
    CLIENTES ||--o{ ORDENES : solicita
    VEHICULOS ||--o{ ORDENES : recibe

    TIPOS_VEHICULO ||--o{ SERVICIOS : clasifica

    ORDENES ||--|{ ORDEN_ITEMS : contiene
    SERVICIOS ||--o{ ORDEN_ITEMS : se_presta_en
    EMPLEADOS ||--o{ ORDEN_ITEMS : ejecuta
    EMPLEADOS ||--o{ NOMINA_LIQUIDACIONES : cobra

    ORDENES ||--o{ CAJA_MOVIMIENTOS : genera_ingreso
    CIERRES_CAJA ||--o{ CAJA_MOVIMIENTOS : consolida
    CAJA_MOVIMIENTOS |o--o| GASTOS_FIJOS : respalda

    PRODUCTOS ||--o{ INVENTARIO_MOVIMIENTOS : mueve
    PRODUCTOS ||--o{ VENTAS_PRODUCTOS : se_vende_en

    PROFILES {
        uuid id PK "= auth.users.id"
        text nombre
        text rol "super_admin | admin | empleado"
        numeric porcentaje_comision
        boolean activo
    }
    EMPLEADOS {
        uuid id PK
        text nombre
        text telefono
        numeric porcentaje_comision
        boolean activo
    }
    CLIENTES {
        uuid id PK
        text nombre
        text telefono
        text placa
    }
    VEHICULOS {
        uuid id PK
        uuid cliente_id FK
        text placa
        text tipo
    }
    TIPOS_VEHICULO {
        text codigo PK
        text nombre
        int orden
        boolean activo
    }
    SERVICIOS {
        uuid id PK
        text categoria
        text nombre
        text tipo_vehiculo FK
        numeric precio
        boolean activo
    }
    ORDENES {
        uuid id PK
        uuid cliente_id FK
        uuid vehiculo_id FK
        text placa
        text estado "en_proceso | completado | entregado"
        text metodo_pago "NULL = sin cobrar"
        numeric total
        timestamptz entregado_at
        uuid created_by FK
    }
    ORDEN_ITEMS {
        uuid id PK
        uuid orden_id FK
        uuid servicio_id FK
        uuid empleado_id FK
        numeric precio
        numeric comision_porcentaje
    }
    CAJA_MOVIMIENTOS {
        uuid id PK
        text tipo "ingreso | egreso"
        text concepto
        text metodo_pago
        numeric monto
        text caja "principal | inventario"
        boolean fuera_de_caja
        uuid orden_id FK
        uuid cierre_id FK
        uuid created_by FK
    }
    CIERRES_CAJA {
        uuid id PK
        text caja
        timestamptz fecha_cierre
        numeric total_efectivo
        numeric total_qr
        numeric total_transferencia
        numeric total_egresos
        numeric total_nomina
        numeric total_gastos
        numeric total_general
        uuid created_by FK
    }
    PRODUCTOS {
        uuid id PK
        text nombre
        numeric stock_actual
        numeric stock_minimo
        numeric precio
    }
    INVENTARIO_MOVIMIENTOS {
        uuid id PK
        uuid producto_id FK
        text tipo "entrada | salida"
        numeric cantidad
        uuid created_by FK
    }
    VENTAS_PRODUCTOS {
        uuid id PK
        uuid producto_id FK
        text producto_nombre
        numeric cantidad
        numeric precio_unitario
        numeric total
        text metodo_pago
        uuid venta_grupo_id "agrupa el carrito"
        uuid created_by FK
    }
    NOMINA_LIQUIDACIONES {
        uuid id PK
        uuid empleado_id FK
        date fecha_inicio
        date fecha_fin
        int total_servicios
        numeric total_facturado
        numeric porcentaje
        numeric total_pagar
    }
    GASTOS_FIJOS {
        uuid id PK
        text categoria "arriendo | agua | luz | ..."
        text concepto
        numeric monto
        date fecha
        text metodo_pago
        uuid caja_movimiento_id FK "NULL = no sale de la caja"
        uuid created_by FK
    }
```

### Cómo leerlo

- **`profiles` vs `empleados`.** Son cosas distintas a propósito: `profiles` son los **usuarios que inician sesión** (1:1 con `auth.users`, el módulo de autenticación de Supabase); `empleados` es el **roster de trabajadores** del lavadero, que no tienen cuenta pero sí comisión y nómina.
- **El flujo del negocio.** `ordenes` → `orden_items` (qué servicios y quién los hizo) → `caja_movimientos` (el cobro) → `cierres_caja` (el corte del día) → `nomina_liquidaciones` (la comisión del trabajador).
- **Dos cajas separadas.** `caja_movimientos.caja` distingue la caja `principal` (servicios) de la de `inventario` (venta de productos); cada una se cierra por aparte.
- **Integridad del historial.** Las llaves hacia `profiles` son `ON DELETE RESTRICT`: un usuario se desactiva (`activo = false`), no se borra, para no perder de quién era cada registro. En cambio `orden_items` es `ON DELETE CASCADE` respecto de `ordenes`: si se elimina una orden, sus ítems se van con ella.
- **Fotos históricas.** `ventas_productos.producto_nombre` y `orden_items.precio` guardan el valor del momento: aunque después cambie el precio o se borre el producto, la venta pasada no se altera.
