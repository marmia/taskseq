import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    fileParallelism: false,
    setupFiles: ["./src/web/test/setup.ts"],
    exclude: [...configDefaults.exclude, "src/worker/**/*.test.ts"],
  },
});
