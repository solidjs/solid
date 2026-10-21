# DBMon — a live server-rendered dashboard

The classic DBMon benchmark, as a page the server keeps rendering. A
simulation of monitored databases lives on the server and ticks while anyone
is watching; every tick re-renders the table on the server and streams it to
the browser as HTML.

Two routes render the same simulation, so they can be compared:

- `/` — the live view. The table is a server component behind a
  `broadcast()` address: every tab sees the same table, so the server
  renders it once and streams the same changes to every viewer. The
  browser only applies the markup it receives.
- `/spa` — the client-rendered twin. The server streams the databases as
  data and the browser renders them with keyed `<For>`s.

```sh
pnpm dev                       # https://localhost:3020/  (self-signed cert)
pnpm build && pnpm start       # production harness, http://localhost:3020/
```

Knobs (environment, read by the server):

```sh
DBMON_ROWS=200 pnpm start      # clusters; each is a primary and a replica row (default 50)
DBMON_MUTATIONS=0.2 pnpm start # share of rows that change per tick (default 0.5)
DBMON_FPS=10 pnpm start        # ticks per second (default 5)
```

Styles come from Solid's [dbmon example](https://github.com/ryansolid/solid-dbmon).
