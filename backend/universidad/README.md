# Montar la base de datos en Supabase (presentación)

Hay **dos versiones** del mismo sistema. Para sustentar conviene la reducida.

| Carpeta | Tablas | Para qué |
|---|---|---|
| **`reducido/`** | **12** | **La de la presentación.** Conserva el hilo completo del negocio y todos los conceptos que se evalúan, pero se explica entero en una sustentación. |
| `completo/` | 15 | Lo que corre en producción hoy. Agrega gastos fijos (arriendo y servicios), vehículos e historial de stock. |

Lo que se recortó en la versión de 12: `gastos_fijos`, `vehiculos` (la orden se queda con la placa directa) e `inventario_movimientos`, más algunas columnas de detalle operativo.

## Orden de ejecución

Cada archivo se pega completo en **Supabase → SQL Editor → New query → Run**.

1. `00_borrar_tablas_de_prueba.sql` — solo si el proyecto todavía tiene el esquema del primer intento (`ventas`, `venta_items`). Si no lo encuentra, aborta sin tocar nada.
2. `reducido/01_schema.sql` — crea las 12 tablas con sus llaves, restricciones e índices, más el catálogo de servicios.
3. **Crear el usuario**: Authentication → Users → Add user, y después:
   ```sql
   insert into public.profiles (id, nombre, rol)
   values ('EL-UUID-DEL-USUARIO', 'Tu Nombre', 'super_admin');
   ```
   Casi todas las tablas guardan *quién* registró cada cosa (`created_by`), por eso hace falta un perfil antes de sembrar datos.
4. `reducido/02_datos_demo.sql` — un día de operación de ejemplo.

Para ver el diagrama ya montado: **Database → Schema Visualizer**.

> Estos archivos crean las **tablas**. La lógica de negocio (funciones `crear_orden`, `cobrar_orden`, `cerrar_caja`, `liquidar_nomina`…) y las políticas RLS están en `backend/migrations/0002` → `0036`. Si querés la aplicación funcionando de verdad contra una base nueva, corré esas migraciones en orden en vez de estos esquemas consolidados.

---

## Modelo entidad-relación (versión de 12 tablas)

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "es"
    PROFILES ||--o{ ORDENES : "registra"
    PROFILES ||--o{ CAJA_MOVIMIENTOS : "registra"
    PROFILES ||--o{ CIERRES_CAJA : "cierra"
    PROFILES ||--o{ VENTAS_PRODUCTOS : "registra"

    CLIENTES ||--o{ ORDENES : "solicita"
    TIPOS_VEHICULO ||--o{ SERVICIOS : "tarifa por"

    ORDENES ||--|{ ORDEN_ITEMS : "detalla"
    SERVICIOS ||--o{ ORDEN_ITEMS : "se presta en"
    EMPLEADOS ||--o{ ORDEN_ITEMS : "ejecuta"
    EMPLEADOS ||--o{ NOMINA_LIQUIDACIONES : "cobra"

    ORDENES ||--o{ CAJA_MOVIMIENTOS : "genera ingreso"
    CIERRES_CAJA ||--o{ CAJA_MOVIMIENTOS : "consolida"

    PRODUCTOS ||--o{ VENTAS_PRODUCTOS : "se vende en"

    PROFILES {
        uuid id PK "= auth.users.id"
        text nombre
        text rol "super_admin | admin | empleado"
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
        uuid orden_id FK
        uuid cierre_id FK "NULL = caja abierta"
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
```

### Cómo leerlo

- **`profiles` vs `empleados`.** Son cosas distintas a propósito: `profiles` son los **usuarios que inician sesión** (uno a uno con `auth.users`, comparten la llave primaria); `empleados` es el **roster de trabajadores**, que no tienen cuenta pero sí comisión y nómina.
- **El muchos a muchos.** `ordenes` ↔ `servicios` se resuelve con la tabla asociativa `orden_items`, que además guarda atributos propios de la relación: el precio cobrado, el porcentaje de comisión y quién ejecutó el trabajo.
- **El flujo del negocio.** `ordenes` → `orden_items` → `caja_movimientos` (el cobro) → `cierres_caja` (el corte del día) → `nomina_liquidaciones` (la comisión).
- **Una llave que codifica un estado.** Mientras `caja_movimientos.cierre_id` sea nulo, el movimiento está en la caja abierta; al cerrar recibe el id del cierre y los totales quedan congelados.
- **Dos cajas separadas.** `caja_movimientos.caja` distingue la caja `principal` (servicios) de la de `inventario` (venta de productos); cada una se cierra por aparte.
- **Integridad del historial.** Las llaves hacia `profiles` son `ON DELETE RESTRICT`: un usuario se desactiva (`activo = false`), no se borra. `orden_items` es `ON DELETE CASCADE` respecto de `ordenes`: si se elimina una orden, sus ítems se van con ella. Y lo opcional es `ON DELETE SET NULL`: borrar una orden no borra el dinero que entró por ella.
- **Fotos históricas.** `orden_items.precio` y `ventas_productos.producto_nombre` guardan el valor del momento: aunque después cambie la tarifa o se borre el producto, lo que ya pasó no se reescribe.
