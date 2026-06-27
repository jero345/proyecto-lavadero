# CAR WASH SERVICES 🚗🏍️

Sistema POS + gestión operativa para lavadero de autos y motos (Colombia).
Monorepo con **frontend** y **backend** separados.

```
proyecto-lavadero/
├── frontend/        # App React + Vite + TS + Tailwind + shadcn/ui
│   ├── src/
│   ├── package.json
│   └── .env.local   # credenciales de Supabase (no se commitea)
└── backend/         # Supabase
    ├── migrations/  # SQL (schema, RLS, funciones, storage)
    └── functions/   # (reservado)
```

## Stack
- **Frontend:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query
- **Backend/DB:** Supabase (Postgres, Auth, RLS, Storage) + funciones RPC `SECURITY DEFINER`
- **Deploy:** Vercel (frontend) + Supabase (backend)

---

## 1) Frontend

```bash
cd frontend
npm install
# Edita .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev          # http://localhost:5173
```

| Comando (dentro de `frontend/`) | Acción |
|---------------------------------|--------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Typecheck + build de producción (`dist/`) |
| `npm run preview` | Previsualiza el build |

### Deploy a Vercel
1. Sube el repo a GitHub e impórtalo en Vercel.
2. **Root Directory: `frontend`** · Framework: **Vite**.
3. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. `frontend/vercel.json` ya incluye el rewrite SPA.

---

## 2) Backend (Supabase)

Aplica las migraciones **en orden** en el SQL Editor de Supabase. Ver
[backend/README.md](backend/README.md) para el detalle.

1. `backend/migrations/0001_schema_inicial.sql` — schema + seed de 36 servicios
2. `backend/migrations/0002_rls.sql` — RLS, `get_rol()`, trigger, realtime
3. `backend/migrations/0003_funciones.sql` — funciones RPC del servidor
4. `backend/migrations/0004_storage.sql` — bucket privado de fotos

> La lógica sensible vive en funciones Postgres `SECURITY DEFINER` (atómicas, sin
> deploy de Docker/CLI). El frontend las invoca con `supabase.rpc(...)`.

---

## Roles
- **super_admin** — acceso total (usuarios + servicios).
- **admin** — operación completa sin gestión de usuarios.
- **empleado** — solo registra órdenes y ve las suyas.

## Estado
Fases 1–8 completas: setup, schema+seed, RLS, auth, POS, lógica de servidor,
pantallas (Dashboard realtime, Caja, Nómina, Inventario, Clientes, Servicios,
Usuarios) y storage de fotos + config de deploy.
