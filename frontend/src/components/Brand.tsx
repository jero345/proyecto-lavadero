import { Car, Bike } from "lucide-react";

import { cn } from "@/lib/utils";

type Size = "sm" | "lg";

const SIZES: Record<Size, { box: string; car: string; bike: string; title: string; sub: string }> = {
  sm: {
    box: "h-9 w-9 rounded-lg",
    car: "h-4 w-4",
    bike: "h-3.5 w-3.5",
    title: "text-sm",
    sub: "text-[10px]",
  },
  lg: {
    box: "h-16 w-16 rounded-2xl",
    car: "h-7 w-7",
    bike: "h-6 w-6",
    title: "text-xl",
    sub: "text-xs",
  },
};

/**
 * Marca única del sistema (logo + nombre). Fuente de verdad del branding:
 * se usa en el Sidebar (horizontal) y en el Login (vertical) para que siempre
 * se vean idénticos.
 */
export function Brand({
  size = "sm",
  vertical = false,
  className,
}: {
  size?: Size;
  vertical?: boolean;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        vertical && "flex-col gap-2 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-sm",
          s.box,
        )}
      >
        <div className="flex items-center gap-0.5">
          <Car className={s.car} />
          <Bike className={s.bike} />
        </div>
      </div>
      <div className={cn("leading-tight", vertical && "leading-snug")}>
        <p className={cn("font-bold tracking-tight", s.title)}>Todo en Uno</p>
        <p
          className={cn(
            "font-medium uppercase tracking-wide text-muted-foreground",
            s.sub,
          )}
        >
          Car Wash Services
        </p>
      </div>
    </div>
  );
}
