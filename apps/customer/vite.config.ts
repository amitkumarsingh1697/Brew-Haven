import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { brewHavenPwa } from "@brew-haven/pwa/vite";

export default defineConfig({
  plugins: [react(), brewHavenPwa("Brew Haven")],
  server: { port: 5173 },
  build: { target: "es2022", sourcemap: true },
});
