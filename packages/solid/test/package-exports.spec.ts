import { createRequire } from "node:module";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);

test("generated declarations are not public package entry points", () => {
  let errorCode: string | undefined;

  try {
    require.resolve("solid-js/types/server/signals.js");
  } catch (error) {
    errorCode = (error as NodeJS.ErrnoException).code;
  }

  expect(errorCode).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
});
