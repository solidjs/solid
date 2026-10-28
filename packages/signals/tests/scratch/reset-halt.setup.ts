import { afterEach } from "vitest";
import { flush, resetErrorHalt } from "../../src/index.js";
afterEach(() => {
  try {
    flush();
  } catch {}
  resetErrorHalt();
});
