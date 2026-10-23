// The number of tabs watching, on both dashboards. It is per tab, not a
// `broadcast`: each tab's stream is what counts it as a viewer.
import { Loading, Show, createMemo, createSignal, onSettled } from "solid-js";
import { getRequestEvent } from "@solidjs/web";
import { live } from "@solidjs/web/server-functions";
import { watchViewers } from "~/server/viewers";

const getViewers = live(async function* (): AsyncGenerator<number> {
  "use server";
  yield* watchViewers(getRequestEvent()?.request.signal);
});

export default function Viewers() {
  // Only a running tab is a viewer, so the stream opens in the browser.
  const [running, setRunning] = createSignal(false);
  onSettled(() => {
    setRunning(true);
  });
  return (
    <p class="viewers">
      <Show when={running()} fallback={" "}>
        <Count />
      </Show>
    </p>
  );
}

function Count() {
  const viewers = createMemo(() => getViewers());
  return (
    <>
      {viewers()} {viewers() === 1 ? "viewer" : "viewers"}
    </>
  );
}
