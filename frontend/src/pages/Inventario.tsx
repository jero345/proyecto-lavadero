import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Pencil,
  Plus,
  ShoppingCart,
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
import { formatCOP, formatFechaHora } from "@/lib/format";
import { METODOS_PAGO, LABEL_METODO_PAGO } from "@/lib/dominio";
import { supabase } from "@/lib/supabase";
import type {
  MetodoPago,
  Producto,
  TipoMovInventario,
  VentaProducto,
} from "@/types/database.types";

export default function Inventario() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Producto | null>(null);
  const [vendiendo, setVendiendo] = useState<Producto | null>(null);

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
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["inventario"] });
    queryClient.invalidateQueries({ queryKey: ["caja"] });
  };

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Productos</h2>
        <NuevoProducto onCreado={invalidar} />
      </div>

      <Card>
        <CardContent className="p-0">
          {productos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay productos. Agrega el primero.
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
                {productos.map((p) => {
                  const bajo = Number(p.stock_actual) <= Number(p.stock_minimo);
                  const sinPrecio = Number(p.precio) <= 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nombre}</TableCell>
                      <TableCell className="text-right">
                        {p.stock_actual} {p.unidad ?? ""}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {p.stock_minimo}
                      </TableCell>
                      <TableCell className="text-right">
                        {sinPrecio ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatCOP(p.precio)
                        )}
                      </TableCell>
                      <TableCell>
                        {bajo ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Bajo
                          </Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            title={
                              sinPrecio
                                ? "Define un precio para poder vender"
                                : "Vender"
                            }
                            disabled={sinPrecio || Number(p.stock_actual) <= 0}
                            onClick={() => setVendiendo(p)}
                          >
                            <ShoppingCart className="h-4 w-4" />
                            Vender
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar producto"
                            onClick={() => setEditando(p)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Entrada de stock"
                            disabled={mover.isPending}
                            onClick={() => {
                              const c = Number(prompt(`Entrada de ${p.nombre}: cantidad`));
                              if (c) mover.mutate({ producto: p, tipo: "entrada", cantidad: c });
                            }}
                          >
                            <ArrowUpCircle className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Salida de stock (ajuste/merma)"
                            disabled={mover.isPending}
                            onClick={() => {
                              const c = Number(prompt(`Salida de ${p.nombre}: cantidad`));
                              if (c) mover.mutate({ producto: p, tipo: "salida", cantidad: c });
                            }}
                          >
                            <ArrowDownCircle className="h-4 w-4 text-destructive" />
                          </Button>
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
        <CardHeader>
          <CardTitle className="text-base">Ventas recientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ventas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aún no hay ventas registradas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventas.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFechaHora(v.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{v.producto_nombre}</TableCell>
                    <TableCell className="text-right">{v.cantidad}</TableCell>
                    <TableCell>{LABEL_METODO_PAGO[v.metodo_pago]}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCOP(v.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Diálogos */}
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

      <Dialog open={Boolean(vendiendo)} onOpenChange={(o) => !o && setVendiendo(null)}>
        {vendiendo && (
          <VenderProducto
            key={vendiendo.id}
            producto={vendiendo}
            onVendido={() => {
              invalidar();
              setVendiendo(null);
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
        unidad: unidad.trim() || null,
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
          unidad: unidad.trim() || null,
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

function VenderProducto({
  producto,
  onVendido,
}: {
  producto: Producto;
  onVendido: () => void;
}) {
  const [cantidad, setCantidad] = useState("1");
  const [metodo, setMetodo] = useState<MetodoPago | "">("");

  const cant = Number(cantidad);
  const total = (Number.isFinite(cant) && cant > 0 ? cant : 0) * Number(producto.precio);

  const vender = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(cant) || cant <= 0) throw new Error("Cantidad inválida");
      if (cant > Number(producto.stock_actual))
        throw new Error("No hay suficiente stock");
      if (!metodo) throw new Error("Selecciona el método de pago");
      const { error } = await supabase.rpc("vender_producto", {
        p_producto_id: producto.id,
        p_cantidad: cant,
        p_metodo_pago: metodo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venta registrada", { description: `Total ${formatCOP(total)}` });
      onVendido();
    },
    onError: (e: unknown) =>
      toast.error("No se pudo vender", {
        description: e instanceof Error ? e.message : "",
      }),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Vender {producto.nombre}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Precio unitario: {formatCOP(producto.precio)}</span>
          <span>Stock: {producto.stock_actual}</span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vp-cant">Cantidad</Label>
          <Input
            id="vp-cant"
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Método de pago</Label>
          <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
            <SelectTrigger>
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
        <div className="flex items-center justify-between rounded-md bg-muted p-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-xl font-bold">{formatCOP(total)}</span>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => vender.mutate()} disabled={vender.isPending}>
          {vender.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar venta
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
