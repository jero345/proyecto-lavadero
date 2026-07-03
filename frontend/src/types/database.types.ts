// Tipos de la base de datos (escritos a mano para reflejar el schema de Supabase).
// Si más adelante instalas la CLI puedes regenerarlos con:
//   supabase gen types typescript --project-id yyjmpwviokpldhcfbodn > src/types/database.types.ts

export type Rol = "super_admin" | "admin" | "empleado";
export type TipoVehiculo = "moto" | "moto_alto" | "auto" | "camioneta";
export type EstadoOrden = "en_proceso" | "completado" | "entregado";
export type MetodoPago = "efectivo" | "qr" | "transferencia";
export type TipoMovCaja = "ingreso" | "egreso";
export type TipoMovInventario = "entrada" | "salida";

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
        Row: { id: string; nombre: string; telefono: string | null; created_at: string };
        Insert: { id?: string; nombre: string; telefono?: string | null; created_at?: string };
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
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          telefono?: string | null;
          porcentaje_comision?: number;
          activo?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["empleados"]["Insert"]>;
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
        };
        Update: Partial<Database["public"]["Tables"]["ordenes"]["Insert"]>;
        Relationships: [];
      };
      orden_items: {
        Row: {
          id: string;
          orden_id: string;
          servicio_id: string;
          empleado_id: string;
          precio: number;
          comision_porcentaje: number;
        };
        Insert: {
          id?: string;
          orden_id: string;
          servicio_id: string;
          empleado_id: string;
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
          orden_id: string | null;
          cierre_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tipo: TipoMovCaja;
          concepto?: string | null;
          metodo_pago?: MetodoPago | null;
          monto: number;
          orden_id?: string | null;
          cierre_id?: string | null;
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
          total_general: number;
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
          total_general?: number;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["cierres_caja"]["Insert"]>;
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
        };
        Insert: {
          id?: string;
          nombre: string;
          stock_actual?: number;
          stock_minimo?: number;
          unidad?: string | null;
          precio?: number;
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
          p_empleado_id: string;
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
      cerrar_caja: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["cierres_caja"]["Row"];
      };
      liquidar_nomina: {
        Args: { p_empleado_id: string; p_fecha_inicio: string; p_fecha_fin: string };
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
      registrar_movimiento_inventario: {
        Args: { p_producto_id: string; p_tipo: TipoMovInventario; p_cantidad: number };
        Returns: Database["public"]["Tables"]["productos"]["Row"];
      };
      vender_producto: {
        Args: { p_producto_id: string; p_cantidad: number; p_metodo_pago: MetodoPago };
        Returns: { venta_id: string; total: number };
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
export type Vehiculo = Database["public"]["Tables"]["vehiculos"]["Row"];
export type Servicio = Database["public"]["Tables"]["servicios"]["Row"];
export type Orden = Database["public"]["Tables"]["ordenes"]["Row"];
export type OrdenItem = Database["public"]["Tables"]["orden_items"]["Row"];
export type CajaMovimiento = Database["public"]["Tables"]["caja_movimientos"]["Row"];
export type CierreCaja = Database["public"]["Tables"]["cierres_caja"]["Row"];
export type Producto = Database["public"]["Tables"]["productos"]["Row"];
export type VentaProducto = Database["public"]["Tables"]["ventas_productos"]["Row"];
export type InventarioMovimiento = Database["public"]["Tables"]["inventario_movimientos"]["Row"];
export type NominaLiquidacion = Database["public"]["Tables"]["nomina_liquidaciones"]["Row"];
