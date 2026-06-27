import {
  LayoutDashboard,
  PlusCircle,
  Wallet,
  Users2,
  Boxes,
  UserCog,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { Rol } from "@/types/database.types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Roles que pueden ver el ítem. */
  roles: Rol[];
}

const TODOS: Rol[] = ["super_admin", "admin", "empleado"];
const STAFF: Rol[] = ["super_admin", "admin"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: TODOS },
  { to: "/pos", label: "Nueva Orden", icon: PlusCircle, roles: TODOS },
  { to: "/caja", label: "Caja", icon: Wallet, roles: STAFF },
  { to: "/empleados", label: "Empleados", icon: UserCog, roles: STAFF },
  { to: "/nomina", label: "Nómina", icon: Users2, roles: STAFF },
  { to: "/inventario", label: "Inventario", icon: Boxes, roles: STAFF },
  { to: "/clientes", label: "Clientes", icon: Users2, roles: STAFF },
  { to: "/servicios", label: "Servicios", icon: Sparkles, roles: STAFF },
];

export const LABEL_ROL: Record<Rol, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  empleado: "Empleado",
};
