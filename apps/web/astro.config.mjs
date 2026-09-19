import { defineConfig } from "astro/config";

export default defineConfig({
  server: { host: true, port: Number(process.env.PORT ?? 4321) }
});
