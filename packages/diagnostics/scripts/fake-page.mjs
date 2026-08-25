// E2E probe for the vite-plugin diagnostics endpoint: connects to a dev
// server's WebSocket exactly like a browser page (vite-hmr protocol),
// installs the real diagnostics bridge, and runs a small live reactive app
// so captures have something to record.
//
// Usage: node --conditions=development scripts/fake-page.mjs [ws://localhost:3002]
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser";
import { createEffect, createMemo, createRoot, createSignal, flush } from "@solidjs/signals";

const target = process.argv[2] ?? "ws://localhost:3002";
const bridge = installDiagnosticsBridge();

const [count, setCount] = createSignal(0, { name: "count" });
createRoot(() => {
  const double = createMemo(() => count() * 2, { name: "double" });
  createEffect(double, () => {}, { name: "render" });
});
flush();
// A "user" clicking every 250ms.
setInterval(() => {
  setCount(current => current + 1);
  flush();
}, 250);

function dispatch(request) {
  switch (request.method) {
    case "begin":
      bridge.begin(request.params);
      return true;
    case "end":
      return bridge.end();
    case "active":
      return bridge.active();
    case "whyDidRun":
      return bridge.whyDidRun(request.params.name);
    case "costs":
      return bridge.costs();
    default:
      throw new Error("Unknown diagnostics method: " + request.method);
  }
}

const ws = new WebSocket(target, "vite-hmr");
ws.addEventListener("open", () => console.log("fake page connected to " + target));
ws.addEventListener("message", async event => {
  const message = JSON.parse(event.data);
  if (message.type !== "custom" || message.event !== "solid:diagnostics:request") return;
  const request = message.data;
  let response;
  try {
    response = { id: request.id, result: await dispatch(request) };
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
  ws.send(
    JSON.stringify({ type: "custom", event: "solid:diagnostics:response", data: response })
  );
});
ws.addEventListener("close", () => process.exit(0));
