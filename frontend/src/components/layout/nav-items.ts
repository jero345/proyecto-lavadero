import {
  LayoutDashboard,
  PlusCircle,
  Wallet,
  Boxes,
  Users,
  HandCoins,
  Contact,
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
  /** Clases del chip de color del icono (estado inactivo). */
  color: string;
}

const TODOS: Rol[] = ["super_admin", "admin", "empleado"];
const STAFF: Rol[] = ["super_admin", "admin"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: TODOS, color: "bg-blue-100 text-blue-600" },
  { to: "/pos", label: "Nueva Orden", icon: PlusCircle, roles: TODOS, color: "bg-indigo-100 text-indigo-600" },
  { to: "/caja", label: "Caja", icon: Wallet, roles: STAFF, color: "bg-emerald-100 text-emerald-600" },
  { to: "/empleados", label: "Empleados", icon: Users, roles: STAFF, color: "bg-violet-100 text-violet-600" },
  { to: "/nomina", label: "Nómina", icon: HandCoins, roles: TODOS, color: "bg-amber-100 text-amber-600" },
  { to: "/inventario", label: "Inventario", icon: Boxes, roles: TODOS, color: "bg-cyan-100 text-cyan-600" },
  { to: "/clientes", label: "Clientes", icon: Contact, roles: TODOS, color: "bg-rose-100 text-rose-600" },
  { to: "/servicios", label: "Servicios", icon: Sparkles, roles: TODOS, color: "bg-fuchsia-100 text-fuchsia-600" },
];

export const LABEL_ROL: Record<Rol, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  empleado: "Empleado",
};
