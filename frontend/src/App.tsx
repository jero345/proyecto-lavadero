import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute, RoleRoute } from "@/components/auth/guards";

// Code-splitting: cada pantalla se carga bajo demanda (bundle más liviano).
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const POS = lazy(() => import("@/pages/POS"));
const Ordenes = lazy(() => import("@/pages/Ordenes"));
const Caja = lazy(() => import("@/pages/Caja"));
const Cierres = lazy(() => import("@/pages/Cierres"));
const Movimientos = lazy(() => import("@/pages/Movimientos"));
const Gastos = lazy(() => import("@/pages/Gastos"));
const Nomina = lazy(() => import("@/pages/Nomina"));
const Inventario = lazy(() => import("@/pages/Inventario"));
const Clientes = lazy(() => import("@/pages/Clientes"));
const Servicios = lazy(() => import("@/pages/Servicios"));
const Empleados = lazy(() => import("@/pages/Empleados"));

function Cargando() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<Cargando />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Rutas protegidas (requieren sesión) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<POS />} />
            {/* Operativo: accesible a todos los usuarios con sesión */}
            <Route path="ordenes" element={<Ordenes />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="servicios" element={<Servicios />} />
            <Route path="nomina" element={<Nomina />} />

            {/* Solo staff (admin / super_admin) */}
            <Route element={<RoleRoute roles={["admin", "super_admin"]} />}>
              <Route path="caja" element={<Caja />} />
              <Route path="cierres" element={<Cierres />} />
              <Route path="movimientos" element={<Movimientos />} />
              <Route path="gastos" element={<Gastos />} />
              <Route path="empleados" element={<Empleados />} />
            </Route>

            {/* Solo super_admin: inventario (productos, ventas y su caja) */}
            <Route element={<RoleRoute roles={["super_admin"]} />}>
              <Route path="inventario" element={<Inventario />} />
            </Route>
          </Route>
        </Route>

        {/* Cualquier otra ruta -> dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
