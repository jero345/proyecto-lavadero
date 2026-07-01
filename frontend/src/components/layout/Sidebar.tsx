import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Brand } from "@/components/Brand";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { rol } = useAuth();

  const items = NAV_ITEMS.filter((item) => (rol ? item.roles.includes(rol) : false));

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-card">
      {/* Marca */}
      <div className="flex h-16 items-center border-b px-5">
        <Brand size="sm" />
      </div>

      {/* Navegación */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map(({ to, label, icon: Icon, color }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                    isActive ? "bg-primary text-primary-foreground shadow-sm" : color,
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t p-3 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} Todo en Uno · Car Wash Services
      </div>
    </aside>
  );
}
