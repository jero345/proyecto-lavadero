import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Minus,
  PackageMinus,
  PackagePlus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatCOP, formatFechaHora } from "@/lib/format";
import { METODOS_PAGO, LABEL_METODO_PAGO } from "@/lib/dominio";
import { imprimirReciboVenta } from "@/lib/recibo";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type {
  CajaMovimiento,
  CierreCaja,
  MetodoPago,
  Producto,
  TipoMovInventario,
  VentaProducto,
  VentaRealizada,
} from "@/types/database.types";

/** Una línea del carrito: qué producto y cuántas unidades. */
interface ItemCarrito {
  producto: Producto;
  cantidad: number;
}

/** Una venta del historial con todas sus líneas (los productos del carrito). */
interface VentaAgrupada {
  /** venta_grupo_id (o el id de la línea, en las ventas viejas). */
  id: string;
  fecha: string;
  metodo: MetodoPago;
  total: number;
  lineas: VentaProducto[];
}

/**
 * La unidad es un texto ("L", "und", "ml"), no una cantidad. Si se escribe un
 * número, el stock se vería como "0 1" en la tabla; se rechaza al guardar.
 */
function validarUnidad(unidad: string): string | null {
  const u = unidad.trim();
  if (!u) return null;
  if (/^[0-9]+([.,][0-9]+)?$/.test(u)) {
    throw new Error("La unidad es un texto (L, und, ml), no una cantidad");
  }
  return u;
}

/** Botón de icono redondo con hover suave — para las acciones de cada fila. */
function IconAction({
  title,
  className,
  disabled,
  onClick,
  children,
}: {
  title: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Inventario: solo super_admin (ruta, menú y RPCs). La caja de inventario es un
 * flujo aparte de la caja principal: sus ventas entran con caja='inventario' y
 * tiene su propio cierre.
 */
export default function Inventario() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Producto | null>(null);
  const [eliminando, setEliminando] = useState<Producto | null>(null);
  // Los desactivados se esconden por defecto para no estorbar al vender.
  const [verInactivos, setVerInactivos] = useState(false);
  // Carrito: se venden varios productos juntos y sale una sola factura.
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [busquedaProd, setBusquedaProd] = useState("");
  const [busquedaVenta, setBusquedaVenta] = useState("");

  const { data: productos = [] } = useQuery({
    queryKey: ["inventario", "productos"],
    queryFn: async (): Promise<Producto[]> => {
      const { data, error } = await supabase.from("productos").select("*").order("nombre");
      if (error) throw error;
      return data;
    },
  });

  const { data: ventas = [] } = useQuery({
    queryKey: ["inventario", "ventas"],
    queryFn: async (): Promise<VentaProducto[]> => {
      const { data, error } = await supabase
        .from("ventas_productos")
        .select("*")
        .order("created_at", { ascending: false })
        // Se piden de a muchas líneas porque una venta puede traer varios
        // productos; después se agrupan por venta.
        .limit(120);
      if (error) throw error;
      return data;
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["inventario"] });
    queryClient.invalidateQueries({ queryKey: ["caja"] });
  };

  // Agregar al carrito: si el producto ya está, suma una unidad (sin pasarse
  // del stock disponible).
  function agregarAlCarrito(producto: Producto) {
    const stock = Number(producto.stock_actual) || 0;
    setCarrito((prev) => {
      const actual = prev.find((it) => it.producto.id === producto.id);
      if (!actual) return [...prev, { producto, cantidad: 1 }];
      if (actual.cantidad >= stock) {
        toast.warning(`Solo hay ${stock} de ${producto.nombre}`);
        return prev;
      }
      return prev.map((it) =>
        it.producto.id === producto.id ? { ...it, cantidad: it.cantidad + 1 } : it,
      );
    });
  }

  const inactivos = useMemo(() => productos.filter((p) => !p.activo).length, [productos]);

  const productosFiltrados = useMemo(() => {
    const q = busquedaProd.trim().toLowerCase();
    return productos.filter(
      (p) => (verInactivos || p.activo) && (!q || p.nombre.toLowerCase().includes(q)),
    );
  }, [productos, busquedaProd, verInactivos]);

  // Las líneas de una misma venta (carrito) se muestran juntas: una fila por
  // venta, con todos sus productos y un solo total. Las ventas viejas, de un
  // solo producto, quedan como grupos de una línea.
  const ventasAgrupadas = useMemo(() => {
    const grupos = new Map<string, VentaAgrupada>();
    for (const v of ventas) {
      const clave = v.venta_grupo_id ?? v.id;
      const grupo = grupos.get(clave);
      if (grupo) {
        grupo.lineas.push(v);
        grupo.total += Number(v.total);
      } else {
        grupos.set(clave, {
          id: clave,
          fecha: v.created_at,
          metodo: v.metodo_pago,
          total: Number(v.total),
          lineas: [v],
        });
      }
    }
    const q = busquedaVenta.trim().toLowerCase();
    const lista = [...grupos.values()];
    return (
      q
        ? lista.filter((g) =>
            g.lineas.some((l) => l.producto_nombre.toLowerCase().includes(q)),
          )
        : lista
    ).slice(0, 25);
  }, [ventas, busquedaVenta]);

  // Registra el movimiento y ajusta el stock de forma atómica (RPC en el servidor).
  const mover = useMutation({
    mutationFn: async ({
      producto,
      tipo,
      cantidad,
    }: {
      producto: Producto;
      tipo: TipoMovInventario;
      cantidad: number;
    }) => {
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("Cantidad inválida");
      const { error } = await supabase.rpc("registrar_movimiento_inventario", {
        p_producto_id: producto.id,
        p_tipo: tipo,
        p_cantidad: cantidad,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimiento registrado");
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo registrar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  // Desactivar: el producto deja de venderse pero conserva stock e historial.
  const cambiarActivo = useMutation({
    mutationFn: async ({ producto, activo }: { producto: Producto; activo: boolean }) => {
      const { error } = await supabase
        .from("productos")
        .update({ activo })
        .eq("id", producto.id);
      if (error) throw error;
    },
    onSuccess: (_data, { producto, activo }) => {
      toast.success(activo ? "Producto activado" : "Producto desactivado");
      // Si se desactiva, se saca del carrito para no venderlo por error.
      if (!activo) {
        setCarrito((prev) => prev.filter((it) => it.producto.id !== producto.id));
      }
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo cambiar el estado", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  // Eliminar: borra el producto y sus movimientos de stock. Las ventas ya
  // hechas y su plata en caja se quedan (guardan el nombre del producto).
  const eliminar = useMutation({
    mutationFn: async (producto: Producto) => {
      const { error } = await supabase.from("productos").delete().eq("id", producto.id);
      if (error) throw error;
      return producto;
    },
    onSuccess: (producto) => {
      toast.success(`«${producto.nombre}» eliminado`);
      setCarrito((prev) => prev.filter((it) => it.producto.id !== producto.id));
      setEliminando(null);
      invalidar();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo eliminar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <div className="space-y-6">
      <CajaInventario />

      {carrito.length > 0 && (
        <CarritoVenta
          carrito={carrito}
          setCarrito={setCarrito}
          onVendido={invalidar}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Productos</h2>
        <NuevoProducto onCreado={invalidar} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar producto…"
            className="pl-8"
            value={busquedaProd}
            onChange={(e) => setBusquedaProd(e.target.value)}
          />
        </div>
        {inactivos > 0 && (
          <Button
            variant={verInactivos ? "secondary" : "ghost"}
            size="sm"
            className="text-muted-foreground"
            onClick={() => setVerInactivos((v) => !v)}
          >
            {verInactivos ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {verInactivos ? "Ocultar" : "Ver"} inactivos ({inactivos})
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {productos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay productos. Agrega el primero.
            </p>
          ) : productosFiltrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {busquedaProd.trim()
                ? `Ningún producto coincide con «${busquedaProd}».`
                : "Todos los productos están desactivados."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productosFiltrados.map((p) => {
                  const stock = Number(p.stock_actual) || 0;
                  const precio = Number(p.precio) || 0;
                  const bajo = stock <= (Number(p.stock_minimo) || 0);
                  const sinPrecio = precio <= 0;
                  const inactivo = !p.activo;
                  return (
                    <TableRow key={p.id} className={cn(inactivo && "opacity-60")}>
                      <TableCell className="font-medium">
                        {p.nombre}
                        {inactivo && (
                          <Badge variant="outline" className="ml-2 font-normal">
                            Inactivo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {stock}
                        {p.unidad && (
                          <span className="ml-1 text-muted-foreground">{p.unidad}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.stock_minimo}
                      </TableCell>
                      <TableCell className="text-right">
                        {sinPrecio ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatCOP(precio)
                        )}
                      </TableCell>
                      <TableCell>
                        {inactivo ? (
                          <span className="text-muted-foreground">—</span>
                        ) : bajo ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Bajo
                          </Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            className="gap-1.5 rounded-full shadow-sm"
                            title={
                              inactivo
                                ? "Producto desactivado"
                                : sinPrecio
                                  ? "Define un precio para poder vender"
                                  : stock <= 0
                                    ? "Sin stock"
                                    : "Agregar al carrito"
                            }
                            disabled={inactivo || sinPrecio || stock <= 0}
                            onClick={() => agregarAlCarrito(p)}
                          >
                            <ShoppingCart className="h-4 w-4" />
                            Agregar
                          </Button>

                          <div className="mx-1 h-6 w-px bg-border" />

                          <IconAction
                            title="Entrada de stock"
                            className="text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700"
                            disabled={inactivo || mover.isPending}
                            onClick={() => {
                              const c = Number(prompt(`Entrada de ${p.nombre}: cantidad`));
                              if (c) mover.mutate({ producto: p, tipo: "entrada", cantidad: c });
                            }}
                          >
                            <PackagePlus className="h-[18px] w-[18px]" />
                          </IconAction>
                          <IconAction
                            title="Salida de stock (ajuste/merma)"
                            className="text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                            disabled={inactivo || mover.isPending}
                            onClick={() => {
                              const c = Number(prompt(`Salida de ${p.nombre}: cantidad`));
                              if (c) mover.mutate({ producto: p, tipo: "salida", cantidad: c });
                            }}
                          >
                            <PackageMinus className="h-[18px] w-[18px]" />
                          </IconAction>
                          <IconAction
                            title="Editar producto"
                            className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            onClick={() => setEditando(p)}
                          >
                            <SquarePen className="h-[18px] w-[18px]" />
                          </IconAction>
                          <IconAction
                            title={inactivo ? "Activar producto" : "Desactivar producto"}
                            className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            disabled={cambiarActivo.isPending}
                            onClick={() =>
                              cambiarActivo.mutate({ producto: p, activo: inactivo })
                            }
                          >
                            {inactivo ? (
                              <Eye className="h-[18px] w-[18px]" />
                            ) : (
                              <EyeOff className="h-[18px] w-[18px]" />
                            )}
                          </IconAction>
                          <IconAction
                            title="Eliminar producto"
                            className="text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                            disabled={eliminar.isPending}
                            onClick={() => setEliminando(p)}
                          >
                            <Trash2 className="h-[18px] w-[18px]" />
                          </IconAction>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ventas recientes */}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Ventas recientes</CardTitle>
          <div className="relative sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar venta…"
              className="pl-8"
              value={busquedaVenta}
              onChange={(e) => setBusquedaVenta(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ventas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aún no hay ventas registradas.
            </p>
          ) : ventasAgrupadas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ninguna venta coincide con «{busquedaVenta}».
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Recibo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventasAgrupadas.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFechaHora(v.fecha)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {v.lineas.map((l) => (
                        <span key={l.id} className="block">
                          {l.producto_nombre}
                          {Number(l.cantidad) > 1 && (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              x{l.cantidad}
                            </span>
                          )}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      {v.lineas.reduce((acc, l) => acc + Number(l.cantidad), 0)}
                    </TableCell>
                    <TableCell>{LABEL_METODO_PAGO[v.metodo]}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCOP(v.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Imprimir recibo"
                        onClick={() =>
                          imprimirReciboVenta({
                            id: v.id,
                            fecha: v.fecha,
                            items: v.lineas,
                            total: v.total,
                            metodo: v.metodo,
                          })
                        }
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Diálogos */}
      <AlertDialog
        open={Boolean(eliminando)}
        onOpenChange={(o) => !o && !eliminar.isPending && setEliminando(null)}
      >
        {eliminando && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar «{eliminando.nombre}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borra el producto y su historial de entradas/salidas de stock. Las
                ventas ya registradas y su plata en la caja de inventario se conservan.
                Si solo quieres dejar de venderlo, mejor desactívalo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={eliminar.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={eliminar.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  eliminar.mutate(eliminando);
                }}
              >
                {eliminar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Sí, eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <Dialog open={Boolean(editando)} onOpenChange={(o) => !o && setEditando(null)}>
        {editando && (
          <EditarProducto
            key={editando.id}
            producto={editando}
            onGuardado={() => {
              invalidar();
              setEditando(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function NuevoProducto({ onCreado }: { onCreado: () => void }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [stock, setStock] = useState("");
  const [minimo, setMinimo] = useState("");
  const [unidad, setUnidad] = useState("");
  const [precio, setPrecio] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Nombre requerido");
      const { error } = await supabase.from("productos").insert({
        nombre: nombre.trim(),
        stock_actual: Number(stock) || 0,
        stock_minimo: Number(minimo) || 0,
        unidad: validarUnidad(unidad),
        precio: Number(precio) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto agregado");
      setNombre("");
      setStock("");
      setMinimo("");
      setUnidad("");
      setPrecio("");
      setOpen(false);
      onCreado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo agregar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Nuevo producto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo producto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="np-nombre">Nombre</Label>
            <Input id="np-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-precio">Precio de venta</Label>
            <Input
              id="np-precio"
              type="number"
              min={0}
              placeholder="0"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="np-stock">Stock</Label>
              <Input
                id="np-stock"
                type="number"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-min">Mínimo</Label>
              <Input
                id="np-min"
                type="number"
                value={minimo}
                onChange={(e) => setMinimo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-unidad">Unidad</Label>
              <Input
                id="np-unidad"
                placeholder="L, und"
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => crear.mutate()} disabled={crear.isPending}>
            {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarProducto({
  producto,
  onGuardado,
}: {
  producto: Producto;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(producto.nombre);
  const [precio, setPrecio] = useState(String(producto.precio));
  const [minimo, setMinimo] = useState(String(producto.stock_minimo));
  const [unidad, setUnidad] = useState(producto.unidad ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Nombre requerido");
      const pr = Number(precio);
      if (!Number.isFinite(pr) || pr < 0) throw new Error("Precio inválido");
      const { error } = await supabase
        .from("productos")
        .update({
          nombre: nombre.trim(),
          precio: pr,
          stock_minimo: Number(minimo) || 0,
          unidad: validarUnidad(unidad),
        })
        .eq("id", producto.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto actualizado");
      onGuardado();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo actualizar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Editar {producto.nombre}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ep-nombre">Nombre</Label>
          <Input id="ep-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ep-precio">Precio de venta</Label>
          <Input
            id="ep-precio"
            type="number"
            min={0}
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ep-min">Stock mínimo</Label>
            <Input
              id="ep-min"
              type="number"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ep-unidad">Unidad</Label>
            <Input
              id="ep-unidad"
              placeholder="L, und"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          El stock se ajusta con los botones de entrada/salida, no aquí.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
          {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Carrito de venta: se agregan varios productos, se cobra una sola vez y sale
 * una sola factura con todas las líneas. El servidor (vender_productos) pone
 * los precios, descuenta el stock de cada producto y mete UN ingreso a la caja
 * de inventario por el total.
 */
function CarritoVenta({
  carrito,
  setCarrito,
  onVendido,
}: {
  carrito: ItemCarrito[];
  setCarrito: React.Dispatch<React.SetStateAction<ItemCarrito[]>>;
  onVendido: () => void;
}) {
  const [metodo, setMetodo] = useState<MetodoPago | "">("");

  const total = carrito.reduce(
    (acc, it) => acc + (Number(it.producto.precio) || 0) * it.cantidad,
    0,
  );
  const unidades = carrito.reduce((acc, it) => acc + it.cantidad, 0);

  function cambiarCantidad(id: string, cantidad: number) {
    setCarrito((prev) =>
      prev.map((it) => (it.producto.id === id ? { ...it, cantidad } : it)),
    );
  }
  function quitar(id: string) {
    setCarrito((prev) => prev.filter((it) => it.producto.id !== id));
  }

  const vender = useMutation({
    mutationFn: async (): Promise<VentaRealizada> => {
      if (carrito.length === 0) throw new Error("El carrito está vacío");
      if (!metodo) throw new Error("Selecciona el método de pago");
      for (const it of carrito) {
        if (!Number.isFinite(it.cantidad) || it.cantidad <= 0) {
          throw new Error(`Cantidad inválida en ${it.producto.nombre}`);
        }
        if (it.cantidad > (Number(it.producto.stock_actual) || 0)) {
          throw new Error(`No hay suficiente stock de ${it.producto.nombre}`);
        }
      }
      const { data, error } = await supabase.rpc("vender_productos", {
        p_items: carrito.map((it) => ({
          producto_id: it.producto.id,
          cantidad: it.cantidad,
        })),
        p_metodo_pago: metodo,
      });
      if (error) throw error;
      return data as VentaRealizada;
    },
    onError: (e: unknown) =>
      toast.error("No se pudo vender", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  // `imprimir` decide si además de cobrar sale la tirilla con todos los ítems.
  function cobrar(imprimir: boolean) {
    vender.mutate(undefined, {
      onSuccess: (venta) => {
        toast.success("Venta registrada", {
          description: `Total ${formatCOP(Number(venta.total))}`,
        });
        if (imprimir) {
          imprimirReciboVenta({
            id: venta.grupo_id,
            fecha: new Date().toISOString(),
            items: venta.items,
            total: Number(venta.total),
            metodo: venta.metodo_pago,
          });
        }
        setCarrito([]);
        setMetodo("");
        onVendido();
      },
    });
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingCart className="h-4 w-4 text-primary" />
          Venta en curso
          <span className="text-sm font-normal text-muted-foreground">
            · {carrito.length} producto{carrito.length === 1 ? "" : "s"} · {unidades}{" "}
            unidad{unidades === 1 ? "" : "es"}
          </span>
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={vender.isPending}
          onClick={() => setCarrito([])}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Vaciar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-lg border">
          {carrito.map((it) => {
            const precio = Number(it.producto.precio) || 0;
            const stock = Number(it.producto.stock_actual) || 0;
            return (
              <div key={it.producto.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.producto.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCOP(precio)} c/u · stock {stock}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconAction
                    title="Quitar una unidad"
                    className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    disabled={it.cantidad <= 1}
                    onClick={() => cambiarCantidad(it.producto.id, it.cantidad - 1)}
                  >
                    <Minus className="h-4 w-4" />
                  </IconAction>
                  <Input
                    className="h-9 w-16 text-center"
                    type="number"
                    min={1}
                    max={stock}
                    value={it.cantidad}
                    onChange={(e) =>
                      cambiarCantidad(it.producto.id, Number(e.target.value))
                    }
                  />
                  <IconAction
                    title="Agregar una unidad"
                    className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    disabled={it.cantidad >= stock}
                    onClick={() => cambiarCantidad(it.producto.id, it.cantidad + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </IconAction>
                </div>
                <span className="w-24 text-right font-semibold">
                  {formatCOP(precio * it.cantidad)}
                </span>
                <IconAction
                  title="Quitar del carrito"
                  className="text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                  onClick={() => quitar(it.producto.id)}
                >
                  <X className="h-4 w-4" />
                </IconAction>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Selecciona método" />
              </SelectTrigger>
              <SelectContent>
                {METODOS_PAGO.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total de la venta</p>
            <p className="text-2xl font-bold">{formatCOP(total)}</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={vender.isPending}
            onClick={() => cobrar(false)}
          >
            Solo cobrar
          </Button>
          <Button disabled={vender.isPending} onClick={() => cobrar(true)}>
            {vender.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Cobrar e imprimir
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Caja de inventario: acumula el dinero de las ventas de productos, separada de
 * la caja principal (caja='inventario'). Tiene su propio cierre y sus totales
 * nunca se suman a los de la caja principal.
 */
function CajaInventario() {
  const queryClient = useQueryClient();

  const { data: abiertos = [] } = useQuery({
    queryKey: ["caja", "inventario", "abiertos"],
    queryFn: async (): Promise<CajaMovimiento[]> => {
      const { data, error } = await supabase
        .from("caja_movimientos")
        .select("*")
        .eq("caja", "inventario")
        .is("cierre_id", null)
        // Los movimientos con fecha de otro día solo viven en el historial.
        .eq("fuera_de_caja", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: cierres = [] } = useQuery({
    queryKey: ["caja", "inventario", "cierres"],
    queryFn: async (): Promise<CierreCaja[]> => {
      const { data, error } = await supabase
        .from("cierres_caja")
        .select("*")
        .eq("caja", "inventario")
        .order("fecha_cierre", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const totales = useMemo(() => {
    const t = { efectivo: 0, qr: 0, transferencia: 0, total: 0 };
    for (const m of abiertos) {
      if (m.tipo === "ingreso" && m.metodo_pago) t[m.metodo_pago] += Number(m.monto);
    }
    t.total = t.efectivo + t.qr + t.transferencia;
    return t;
  }, [abiertos]);

  const cerrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cerrar_caja", { p_caja: "inventario" });
      if (error) throw error;
      return data as CierreCaja;
    },
    onSuccess: (c) => {
      toast.success("Caja de inventario cerrada", {
        description: `Total ${formatCOP(c.total_general)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["caja"] });
    },
    onError: (e: unknown) =>
      toast.error("No se pudo cerrar", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Caja de inventario</CardTitle>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={abiertos.length === 0 || cerrar.isPending}
            >
              {cerrar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Cerrar caja de inventario
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cerrar la caja de inventario?</AlertDialogTitle>
              <AlertDialogDescription>
                Se consolidarán {abiertos.length} movimiento(s) por un total de{" "}
                <strong>{formatCOP(totales.total)}</strong>. Es independiente de la caja
                principal.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => cerrar.mutate()}>
                Sí, cerrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TileCaja titulo="Efectivo" valor={totales.efectivo} />
          <TileCaja titulo="QR" valor={totales.qr} />
          <TileCaja titulo="Transferencia" valor={totales.transferencia} />
          <TileCaja titulo="Total sin cerrar" valor={totales.total} destacado />
        </div>
        {cierres.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Último cierre: {formatFechaHora(cierres[0].fecha_cierre)} ·{" "}
            {formatCOP(cierres[0].total_general)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TileCaja({
  titulo,
  valor,
  destacado,
}: {
  titulo: string;
  valor: number;
  destacado?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-3", destacado && "border-primary")}>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={cn("mt-1 text-lg font-bold", destacado && "text-primary")}>
        {formatCOP(valor)}
      </p>
    </div>
  );
}
