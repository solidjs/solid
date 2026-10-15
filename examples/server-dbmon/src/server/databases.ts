// The monitored databases. They live here, on the server, the way a real
// monitoring backend's would: one simulation for every open tab, ticking
// only while someone is watching.
//
// Knobs (environment):
//   DBMON_ROWS       clusters; each is a primary and a replica row (default 50)
//   DBMON_MUTATIONS  share of rows that get a new sample per tick, 0-1 (default 0.5)
//   DBMON_FPS        ticks per second (default 5)
//
// A row that didn't change keeps its object, so a renderer can tell what
// changed by reference.

export interface Query {
  elapsed: number;
  formatted: string;
  className: string;
  text: string;
}

export interface Database {
  id: number;
  name: string;
  count: number;
  countClass: string;
  top5: Query[];
}

const ROWS = Number(process.env.DBMON_ROWS || 50);
const MUTATIONS = Number(process.env.DBMON_MUTATIONS ?? 0.5);
const FPS = Number(process.env.DBMON_FPS || 5);

const QUERIES = [
  "SELECT blah FROM something",
  "<IDLE> in transaction",
  "vacuum",
  "<IDLE>",
  "UPDATE accounts SET balance = balance - 1"
];

function formatElapsed(value: number) {
  let str = value.toFixed(2);
  if (value > 60) {
    const minutes = Math.floor(value / 60);
    const comps = (value % 60).toFixed(2).split(".");
    str = minutes + ":" + comps[0].padStart(2, "0") + "." + comps[1];
  }
  return str;
}

function sample(id: number, name: string): Database {
  const count = Math.floor(Math.random() * 10 + 1) + (Math.random() > 0.9 ? 15 : 0);
  const queries: Query[] = [];
  for (let i = 0; i < count; i++) {
    const elapsed = Math.random() * 15;
    queries.push({
      elapsed,
      formatted: formatElapsed(elapsed),
      className:
        elapsed >= 10 ? "elapsed warn_long" : elapsed >= 1 ? "elapsed warn" : "elapsed short",
      text: QUERIES[Math.floor(Math.random() * QUERIES.length)]
    });
  }
  queries.sort((a, b) => b.elapsed - a.elapsed);
  const top5 = queries.slice(0, 5);
  while (top5.length < 5) top5.push({ elapsed: 0, formatted: "", className: "", text: "" });
  return {
    id,
    name,
    count,
    countClass:
      count >= 20
        ? "label label-important"
        : count >= 10
          ? "label label-warning"
          : "label label-success",
    top5
  };
}

let databases: Database[] = [];
for (let i = 0; i < ROWS; i++) {
  databases.push(sample(i * 2, `cluster${i + 1}`), sample(i * 2 + 1, `cluster${i + 1}slave`));
}

const watchers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  databases = databases.map(db => (Math.random() < MUTATIONS ? sample(db.id, db.name) : db));
  for (const notify of watchers) notify();
}

/** The databases now, then again after every tick, until `signal` aborts. */
export async function* watchDatabases(signal?: AbortSignal): AsyncGenerator<Database[]> {
  let wake: (() => void) | undefined;
  let dirty = false;
  const notify = () => {
    dirty = true;
    wake?.();
  };
  watchers.add(notify);
  timer ??= setInterval(tick, 1000 / FPS);
  const stop = () => {
    watchers.delete(notify);
    if (!watchers.size && timer) (clearInterval(timer), (timer = undefined));
    wake?.();
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    yield databases;
    while (!signal?.aborted) {
      if (!dirty) await new Promise<void>(r => (wake = r));
      wake = undefined;
      if (signal?.aborted) return;
      dirty = false;
      yield databases;
    }
  } finally {
    stop();
  }
}
