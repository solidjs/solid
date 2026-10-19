/** @jsxImportSource @solidjs/web */
import { expect, test } from "vitest";
import {
  deferredApp,
  deferredModuleApp,
  sequentialDeferredModuleApp
} from "../harness/deferred-hydration.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

test("DeferredHydration renders children even when both client gates are closed", async () => {
  const entered: string[] = [];
  const App = deferredApp({
    ready: () => false,
    nestedReady: () => false,
    entered: n => entered.push(n)
  });
  const result = await recordStream(() => <App />);
  expect(result.shell).toContain("preserved context");
  expect(result.shell).toContain("nested context:");
  expect(result.shell).toContain("following sibling");
  expect(result.shell).not.toContain("client fallback");
  expect(entered).toEqual(["outer", "nested"]);
  expect(result.chunks).toEqual([]);
  const other = await recordStream(() => <App />, { renderId: "other" });
  const AsyncApp = deferredApp({ ready: () => false, async: true });
  const streamed = await recordStream(() => <AsyncApp />);
  expect(streamed.shell).toContain("native pending");
  expect(streamed.rest).toContain("async content");
  expect(streamed.chunks.length).toBeGreaterThan(0);
  const ModuleApp = deferredModuleApp({ ready: () => false });
  const module = await recordStream(() => <ModuleApp />);
  expect(module.shell).toContain("module content");
  expect(module.shell).not.toContain("module pending");
  expect(module.chunks).toEqual([]);
  const HandledModuleApp = deferredModuleApp({ ready: () => false, handledFailure: () => {} });
  const handledModule = await recordStream(() => <HandledModuleApp />);
  expect(handledModule.shell).toContain("inner content");
  expect(handledModule.shell).toContain("module content");
  expect(handledModule.shell).not.toContain("module pending");
  expect(handledModule.chunks).toEqual([]);
  const NestedModuleApp = deferredModuleApp({ ready: () => false, outerFailure: () => {} });
  const nestedModule = await recordStream(() => <NestedModuleApp />);
  expect(nestedModule.shell).toContain("module content");
  expect(nestedModule.shell).toContain("outer content");
  expect(nestedModule.shell).not.toContain("inner pending");
  expect(nestedModule.chunks).toEqual([]);
  const SequentialModuleApp = sequentialDeferredModuleApp({
    ready: () => false,
    nestedReady: () => false
  });
  const sequentialModule = await recordStream(() => <SequentialModuleApp />);
  expect(sequentialModule.shell).toContain("dynamic nested");
  expect(sequentialModule.shell).toContain('data-context="preserved context"');
  expect(sequentialModule.chunks).toEqual([]);
  writeArtifact("deferred-hydration", {
    ...result,
    other,
    streamed,
    module,
    handledModule,
    nestedModule,
    sequentialModule
  });
});
