// Wire state for the UI. `live` erases deaths from the value stream on
// purpose — a consumer sees values, never the reconnects behind them — so
// `onstatus` on the returned iterable is the only place to learn them.
// `watch(src)` wires that hook to a signal; <StatusPill> shows it.
//
// The hook is set only in the browser: the server half's call is a promise
// of the branded iterable (in process there is no wire), and the render
// there has no status to show anyway.
import { createSignal, type Accessor } from "solid-js";
import { isServer } from "@solidjs/web";
import type { LiveSource, LiveSourceStatus } from "@solidjs/web/server-functions";

export type Status = LiveSourceStatus | "connecting";

export interface Wire {
  status: Accessor<Status>;
  deaths: Accessor<number>;
  error: Accessor<unknown>;
}

export function createWire(): Wire & { watch<T>(src: LiveSource<T>): LiveSource<T> } {
  const [status, setStatus] = createSignal<Status>("connecting");
  const [deaths, setDeaths] = createSignal(0);
  const [error, setError] = createSignal<unknown>();
  let current: object | undefined;
  return {
    status,
    deaths,
    error,
    // Called from inside the memo's compute, so it must not write signals
    // itself — the hook fires later, from the transport, which is fine.
    // Each call of a live reference is its own iterable with its own
    // lifecycle; the token keeps the pill on the CURRENT one (a room switch
    // hands the memo a new iterable, and the old one's "closed" is ignored).
    watch(src) {
      if (!isServer) {
        const token = (current = {});
        src.onstatus = (state, err) => {
          if (current !== token) return;
          setStatus(state);
          if (state === "reconnecting") {
            setDeaths(n => n + 1);
            setError(err);
          }
        };
      }
      return src;
    }
  };
}

export default function StatusPill(props: { wire: Wire; label?: string }) {
  return (
    <span class={`pill pill-${props.wire.status()}`} title={describe(props.wire.error())}>
      <span class="dot" />
      {props.label ? `${props.label} · ` : ""}
      {props.wire.status()}
      {props.wire.deaths() > 0
        ? ` (${props.wire.deaths()} reconnect${props.wire.deaths() === 1 ? "" : "s"})`
        : ""}
    </span>
  );
}

function describe(error: unknown): string {
  if (error == null) return "";
  return error instanceof Error ? error.message : String(error);
}
