// Tipos de la base de datos (escritos a mano para reflejar el schema de Supabase).
// Si más adelante instalas la CLI puedes regenerarlos con:
//   supabase gen types typescript --project-id yyjmpwviokpldhcfbodn > src/types/database.types.ts

export type Rol = "super_admin" | "admin" | "empleado";
// Tipo de vehículo = código del catálogo `tipos_vehiculo` (dinámico). Los 4
// base son 'moto' | 'moto_alto' | 'auto' | 'camioneta', pero el staff crea más.
export type TipoVehiculo = string;
export type EstadoOrden = "en_proceso" | "completado" | "entregado";
export type MetodoPago = "efectivo" | "qr" | "transferencia";
export type TipoMovCaja = "ingreso" | "egreso";
export type TipoMovInventario = "entrada" | "salida";
export type CajaTipo = "principal" | "inventario";
/** De dónde salió el abono a un préstamo. */
export type OrigenAbono = "manual" | "nomina";

/** Lo que devuelve vender_productos: la venta recién hecha, lista para la tirilla. */
export interface VentaRealizada {
  grupo_id: string;
  total: number;
  metodo_pago: MetodoPago;
  items: {
    producto_nombre: string;
    cantidad: number;
    precio_unitario: number;
    total: number;
  }[];
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          nombre: string;
          rol: Rol;
          porcentaje_comision: number;
          activo: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          nombre: string;
          rol?: Rol;
          porcentaje_comision?: number;
          activo?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      clientes: {
        Row: {
          id: string;
          nombre: string;
          telefono: string | null;
          placa: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          telefono?: string | null;
          placa?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clientes"]["Insert"]>;
        Relationships: [];
      };
      empleados: {
        Row: {
          id: string;
          nombre: string;
          telefono: string | null;
          porcentaje_comision: number;
          activo: boolean;
          observaciones: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          telefono?: string | null;
          porcentaje_comision?: number;
          activo?: boolean;
          observaciones?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["empleados"]["Insert"]>;
        Relationships: [];
      };
      tipos_vehiculo: {
        Row: {
          codigo: string;
          nombre: string;
          orden: number;
          activo: boolean;
          created_at: string;
        };
        Insert: {
          codigo: string;
          nombre: string;
          orden?: number;
          activo?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tipos_vehiculo"]["Insert"]>;
        Relationships: [];
      };
      vehiculos: {
        Row: { id: string; cliente_id: string | null; placa: string; tipo: TipoVehiculo };
        Insert: { id?: string; cliente_id?: string | null; placa: string; tipo: TipoVehiculo };
        Update: Partial<Database["public"]["Tables"]["vehiculos"]["Insert"]>;
        Relationships: [];
      };
      servicios: {
        Row: {
          id: string;
          categoria: string;
          nombre: string;
          descripcion: string | null;
          tipo_vehiculo: TipoVehiculo;
          precio: number;
          activo: boolean;
        };
        Insert: {
          id?: string;
          categoria: string;
          nombre: string;
          descripcion?: string | null;
          tipo_vehiculo: TipoVehiculo;
          precio: number;
          activo?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["servicios"]["Insert"]>;
        Relationships: [];
      };
      ordenes: {
        Row: {
          id: string;
          cliente_id: string | null;
          vehiculo_id: string | null;
          placa: string | null;
          estado: EstadoOrden;
          metodo_pago: MetodoPago | null;
          total: number;
          foto_url: string | null;
          observaciones: string | null;
          created_by: string;
          created_at: string;
          entregado_at: string | null;
        };
        Insert: {
          id?: string;
          cliente_id?: string | null;
          vehiculo_id?: string | null;
          placa?: string | null;
          estado?: EstadoOrden;
          metodo_pago?: MetodoPago | null;
          total?: number;
          foto_url?: string | null;
          observaciones?: string | null;
          created_by: string;
          created_at?: string;
          entregado_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ordenes"]["Insert"]>;
        Relationships: [];
      };
      orden_items: {
        Row: {
          id: string;
          orden_id: string;
          servicio_id: string;
          empleado_id: string | null;
          precio: number;
          comision_porcentaje: number;
        };
        Insert: {
          id?: string;
          orden_id: string;
          servicio_id: string;
          empleado_id?: string | null;
          precio: number;
          comision_porcentaje?: number;
        };
        Update: Partial<Database["public"]["Tables"]["orden_items"]["Insert"]>;
        Relationships: [];
      };
      caja_movimientos: {
        Row: {
          id: string;
          tipo: TipoMovCaja;
          concepto: string | null;
          metodo_pago: MetodoPago | null;
          monto: number;
          caja: CajaTipo;
          orden_id: string | null;
          cierre_id: string | null;
          /** true = fecha de otro día: solo historial, no entra a la caja abierta. */
          fuera_de_caja: boolean;
          /** Venta de inventario que generó este ingreso. */
          venta_grupo_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tipo: TipoMovCaja;
          concepto?: string | null;
          metodo_pago?: MetodoPago | null;
          monto: number;
          caja?: CajaTipo;
          orden_id?: string | null;
          cierre_id?: string | null;
          fuera_de_caja?: boolean;
          venta_grupo_id?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["caja_movimientos"]["Insert"]>;
        Relationships: [];
      };
      cierres_caja: {
        Row: {
          id: string;
          fecha_apertura: string | null;
          fecha_cierre: string;
          total_efectivo: number;
          total_qr: number;
          total_transferencia: number;
          total_egresos: number;
          total_nomina: number;
          /** Gastos fijos (arriendo, servicios) del cierre. Restan del general. */
          total_gastos: number;
          total_general: number;
          total_general_manual: boolean;
          total_general_editado_por: string | null;
          total_general_editado_at: string | null;
          caja: CajaTipo;
          created_by: string;
        };
        Insert: {
          id?: string;
          fecha_apertura?: string | null;
          fecha_cierre?: string;
          total_efectivo?: number;
          total_qr?: number;
          total_transferencia?: number;
          total_egresos?: number;
          total_nomina?: number;
          total_gastos?: number;
          total_general?: number;
          total_general_manual?: boolean;
          total_general_editado_por?: string | null;
          total_general_editado_at?: string | null;
          caja?: CajaTipo;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["cierres_caja"]["Insert"]>;
        Relationships: [];
      };
      gastos_fijos: {
        Row: {
          id: string;
          categoria: string;
          concepto: string | null;
          monto: number;
          fecha: string;
          metodo_pago: MetodoPago | null;
          /** Egreso de caja de este gasto (desde 0038 siempre lo tiene). */
          caja_movimiento_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          categoria: string;
          concepto?: string | null;
          monto: number;
          fecha?: string;
          metodo_pago?: MetodoPago | null;
          caja_movimiento_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["gastos_fijos"]["Insert"]>;
        Relationships: [];
      };
      productos: {
        Row: {
          id: string;
          nombre: string;
          stock_actual: number;
          stock_minimo: number;
          unidad: string | null;
          precio: number;
          /** false = desactivado: no se vende ni se mueve, conserva historial. */
          activo: boolean;
        };
        Insert: {
          id?: string;
          nombre: string;
          stock_actual?: number;
          stock_minimo?: number;
          unidad?: string | null;
          precio?: number;
          activo?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["productos"]["Insert"]>;
        Relationships: [];
      };
      ventas_productos: {
        Row: {
          id: string;
          producto_id: string | null;
          producto_nombre: string;
          cantidad: number;
          precio_unitario: number;
          total: number;
          metodo_pago: MetodoPago;
          /** Agrupa las líneas de una misma venta (carrito). */
          venta_grupo_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          producto_id?: string | null;
          producto_nombre: string;
          cantidad: number;
          precio_unitario: number;
          total: number;
          metodo_pago: MetodoPago;
          venta_grupo_id?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ventas_productos"]["Insert"]>;
        Relationships: [];
      };
      inventario_movimientos: {
        Row: {
          id: string;
          producto_id: string;
          tipo: TipoMovInventario;
          cantidad: number;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          producto_id: string;
          tipo: TipoMovInventario;
          cantidad: number;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inventario_movimientos"]["Insert"]>;
        Relationships: [];
      };
      prestamos: {
        Row: {
          id: string;
          empleado_id: string;
          monto: number;
          fecha: string;
          metodo_pago: MetodoPago;
          concepto: string | null;
          /** Egreso de caja con el que se entregó la plata. */
          caja_movimiento_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          empleado_id: string;
          monto: number;
          fecha?: string;
          metodo_pago: MetodoPago;
          concepto?: string | null;
          caja_movimiento_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prestamos"]["Insert"]>;
        Relationships: [];
      };
      prestamo_abonos: {
        Row: {
          id: string;
          prestamo_id: string;
          monto: number;
          fecha: string;
          /** null cuando el abono salió de la nómina (no entra plata al cajón). */
          metodo_pago: MetodoPago | null;
          origen: OrigenAbono;
          liquidacion_id: string | null;
          caja_movimiento_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          prestamo_id: string;
          monto: number;
          fecha?: string;
          metodo_pago?: MetodoPago | null;
          origen?: OrigenAbono;
          liquidacion_id?: string | null;
          caja_movimiento_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prestamo_abonos"]["Insert"]>;
        Relationships: [];
      };
      nomina_liquidaciones: {
        Row: {
          id: string;
          empleado_id: string;
          fecha_inicio: string;
          fecha_fin: string;
          total_servicios: number;
          total_facturado: number;
          porcentaje: number;
          total_pagar: number;
          /** Lo que se le descontó de sus préstamos (el egreso de caja es el neto). */
          abono_prestamo: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          empleado_id: string;
          fecha_inicio: string;
          fecha_fin: string;
          total_servicios?: number;
          total_facturado?: number;
          porcentaje?: number;
          total_pagar?: number;
          abono_prestamo?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["nomina_liquidaciones"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_rol: { Args: Record<string, never>; Returns: string };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_super_admin: { Args: Record<string, never>; Returns: boolean };
      crear_orden: {
        Args: {
          p_servicio_ids: string[];
          p_empleado_id: string | null;
          p_metodo_pago: MetodoPago | null;
          p_placa: string | null;
          p_cliente_id?: string | null;
          p_vehiculo_id?: string | null;
          p_foto_url?: string | null;
          p_observaciones?: string | null;
          p_total_override?: number | null;
        };
        Returns: { orden_id: string; total: number; items: number; cobrada: boolean };
      };
      cobrar_orden: {
        Args: { p_orden_id: string; p_metodo_pago: MetodoPago };
        Returns: Database["public"]["Tables"]["ordenes"]["Row"];
      };
      asignar_empleado_orden: {
        Args: { p_orden_id: string; p_empleado_id: string };
        Returns: Database["public"]["Tables"]["ordenes"]["Row"];
      };
      cerrar_caja: {
        Args: { p_caja?: CajaTipo };
        Returns: Database["public"]["Tables"]["cierres_caja"]["Row"];
      };
      liquidar_nomina: {
        Args: {
          p_empleado_id: string;
          p_fecha_inicio: string;
          p_fecha_fin: string;
          p_metodo_pago?: MetodoPago;
          /** Cuánto descontarle de sus préstamos en esta liquidación. */
          p_abono_prestamo?: number;
        };
        Returns: Database["public"]["Tables"]["nomina_liquidaciones"]["Row"];
      };
      avanzar_estado_orden: {
        Args: { p_orden_id: string };
        Returns: Database["public"]["Tables"]["ordenes"]["Row"];
      };
      eliminar_orden: {
        Args: { p_orden_id: string };
        Returns: undefined;
      };
      eliminar_movimiento: {
        Args: { p_mov_id: string };
        Returns: undefined;
      };
      eliminar_liquidacion: {
        Args: { p_id: string };
        Returns: undefined;
      };
      detalle_nomina: {
        Args: { p_empleado_id: string; p_fecha_inicio: string; p_fecha_fin: string };
        Returns: {
          orden_id: string;
          fecha: string;
          placa: string | null;
          total: number;
          servicios: string | null;
        }[];
      };
      empleados_pendientes_liquidar: {
        Args: Record<string, never>;
        Returns: {
          empleado_id: string;
          nombre: string;
          /** Órdenes que atendió hoy (una orden cuenta una vez). */
          ordenes: number;
          total: number;
        }[];
      };
      editar_total_cierre: {
        /** p_total null = quitar el ajuste manual y volver al total calculado. */
        Args: { p_cierre_id: string; p_total: number | null };
        Returns: Database["public"]["Tables"]["cierres_caja"]["Row"];
      };
      editar_movimiento: {
        Args: {
          p_mov_id: string;
          p_tipo: TipoMovCaja;
          p_concepto: string | null;
          p_metodo_pago: MetodoPago;
          p_monto: number;
          /** ISO. Si cambia, se recalcula si el movimiento entra o no a la caja. */
          p_fecha?: string;
        };
        Returns: Database["public"]["Tables"]["caja_movimientos"]["Row"];
      };
      crear_movimiento: {
        Args: {
          p_tipo: TipoMovCaja;
          p_concepto: string | null;
          p_metodo_pago: MetodoPago;
          p_monto: number;
          p_caja?: CajaTipo;
          /** ISO. Si no es de hoy, el movimiento nace fuera de la caja abierta. */
          p_fecha?: string;
        };
        Returns: Database["public"]["Tables"]["caja_movimientos"]["Row"];
      };
      registrar_movimiento_inventario: {
        Args: { p_producto_id: string; p_tipo: TipoMovInventario; p_cantidad: number };
        Returns: Database["public"]["Tables"]["productos"]["Row"];
      };
      vender_producto: {
        Args: { p_producto_id: string; p_cantidad: number; p_metodo_pago: MetodoPago };
        Returns: VentaRealizada;
      };
      vender_productos: {
        /** p_items = [{ producto_id, cantidad }] — el precio lo pone el servidor. */
        Args: { p_items: { producto_id: string; cantidad: number }[]; p_metodo_pago: MetodoPago };
        Returns: VentaRealizada;
      };
      guardar_gasto_fijo: {
        /** p_id null = gasto nuevo. p_afecta_caja crea/actualiza su egreso. */
        Args: {
          p_id: string | null;
          p_categoria: string;
          p_concepto: string | null;
          p_monto: number;
          p_fecha: string;
          p_metodo_pago: MetodoPago | null;
          p_afecta_caja?: boolean;
        };
        Returns: Database["public"]["Tables"]["gastos_fijos"]["Row"];
      };
      eliminar_gasto_fijo: {
        Args: { p_id: string };
        Returns: undefined;
      };
      editar_venta: {
        /** p_items = [{ producto_id, cantidad }] — el precio lo pone el servidor. */
        Args: {
          p_grupo_id: string;
          p_items: { producto_id: string; cantidad: number }[];
          p_metodo_pago: MetodoPago;
        };
        Returns: VentaRealizada;
      };
      eliminar_venta: {
        Args: { p_grupo_id: string };
        Returns: undefined;
      };
      guardar_prestamo: {
        /** p_id null = préstamo nuevo. */
        Args: {
          p_id: string | null;
          p_empleado_id: string;
          p_monto: number;
          p_fecha: string;
          p_metodo_pago: MetodoPago;
          p_concepto?: string | null;
        };
        Returns: Database["public"]["Tables"]["prestamos"]["Row"];
      };
      eliminar_prestamo: {
        Args: { p_id: string };
        Returns: undefined;
      };
      abonar_prestamo: {
        Args: {
          p_prestamo_id: string;
          p_monto: number;
          p_fecha: string;
          p_metodo_pago: MetodoPago;
        };
        Returns: Database["public"]["Tables"]["prestamo_abonos"]["Row"];
      };
      eliminar_abono: {
        Args: { p_id: string };
        Returns: undefined;
      };
      saldo_prestamos_empleado: {
        Args: { p_empleado_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// Atajos cómodos para usar en la app.
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Cliente = Database["public"]["Tables"]["clientes"]["Row"];
export type Empleado = Database["public"]["Tables"]["empleados"]["Row"];
export type TipoVehiculoRow = Database["public"]["Tables"]["tipos_vehiculo"]["Row"];
export type Vehiculo = Database["public"]["Tables"]["vehiculos"]["Row"];
export type Servicio = Database["public"]["Tables"]["servicios"]["Row"];
export type Orden = Database["public"]["Tables"]["ordenes"]["Row"];
export type OrdenItem = Database["public"]["Tables"]["orden_items"]["Row"];
export type CajaMovimiento = Database["public"]["Tables"]["caja_movimientos"]["Row"];
export type CierreCaja = Database["public"]["Tables"]["cierres_caja"]["Row"];
export type GastoFijo = Database["public"]["Tables"]["gastos_fijos"]["Row"];
export type Producto = Database["public"]["Tables"]["productos"]["Row"];
export type VentaProducto = Database["public"]["Tables"]["ventas_productos"]["Row"];
export type InventarioMovimiento = Database["public"]["Tables"]["inventario_movimientos"]["Row"];
export type NominaLiquidacion = Database["public"]["Tables"]["nomina_liquidaciones"]["Row"];
export type Prestamo = Database["public"]["Tables"]["prestamos"]["Row"];
export type PrestamoAbono = Database["public"]["Tables"]["prestamo_abonos"]["Row"];
