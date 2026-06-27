import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NAV_ITEMS } from "./nav-items";

function tituloDeRuta(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const item = NAV_ITEMS.find((i) => i.to !== "/" && pathname.startsWith(i.to));
  return item?.label ?? "Todo en Uno · Car Wash Services";
}

export function AppLayout() {
  const location = useLocation();
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const titulo = tituloDeRuta(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      {/* Sidebar fijo (desktop) */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Drawer (móvil) */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          drawerAbierto ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity",
            drawerAbierto ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerAbierto(false)}
        />
        <div
          className={cn(
            "absolute left-0 top-0 h-full transition-transform",
            drawerAbierto ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar onNavigate={() => setDrawerAbierto(false)} />
        </div>
      </div>

      {/* Contenido */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header titulo={titulo} onMenu={() => setDrawerAbierto(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
