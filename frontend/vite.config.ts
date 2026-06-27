import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configuración de Vite. Alias "@" apunta a ./src para imports limpios.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
