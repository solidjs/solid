// In-page fiber event log — the demo's "network tab". Writes happen from
// inside Effect programs (Effect.sync / finalizers), which run on Effect's
// scheduler outside any Solid transaction, so entries commit immediately
// even while an action's transition is in flight.

import { createStore } from "solid-js";

export type LogKind = "start" | "success" | "retry" | "interrupt" | "compensate" | "error";

export interface LogEntry {
  id: number;
  time: string;
  kind: LogKind;
  message: string;
}

let nextId = 0;
const start = performance.now();

const [entries, setEntries] = createStore<LogEntry[]>([]);

export { entries as logEntries };

export function log(kind: LogKind, message: string) {
  const time = ((performance.now() - start) / 1000).toFixed(2) + "s";
  setEntries(list => {
    list.push({ id: nextId++, time, kind, message });
    if (list.length > 100) list.splice(0, list.length - 100);
  });
}

export function clearLog() {
  setEntries(list => {
    list.length = 0;
  });
}
