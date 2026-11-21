import { mergeConfig } from "vitest/config";
import base from "./vite.config";
export default mergeConfig((base as any)({ mode: "test" }), {
  test: { setupFiles: ["./tests/_thin/setup.ts"] }
});
