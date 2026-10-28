import { mergeConfig } from "vite";
import base from "./vite.config";
export default (env: any) =>
  mergeConfig((base as any)(env), { test: { setupFiles: ["./tests/scratch/reset-halt.setup.ts"] } });
