// The adapter runs directly in Node before the TypeScript worker is bundled.
import { calibrationTarget, sourceLabel } from "./build-paths.mjs";

test.each([
  ["/repo/signals/src/core/async.ts", "/repo/signals"],
  [String.raw`C:\repo\signals\src\core\async.ts`, String.raw`C:\repo\signals`]
])("calibration and source labels accept native path %s", (file, root) => {
  expect(calibrationTarget(file, "async.ts")).toBe(true);
  expect(calibrationTarget(file, "scheduler.ts")).toBe(false);
  expect(sourceLabel(file, root)).toBe("SIGNALS/src/core/async.ts");
  expect(sourceLabel(file + ".backup", root)).toBe("SIGNALS/src/core/async.ts.backup");
  expect(calibrationTarget(file + ".backup", "async.ts")).toBe(false);
});
