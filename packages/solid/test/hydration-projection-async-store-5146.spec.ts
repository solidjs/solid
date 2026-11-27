/**
 * @vitest-environment jsdom
 */
// #5146: a server projection (or derived optimistic store) whose fn waits on a
// pending async source and then resolves synchronously is derived from its
// source, not an async answer of its own. Serializing it caused client
// hydration to adopt a static snapshot instead of running fn against the
// hydrated source, so later writes to the source never reached the projection.
import { describe, expect, test, afterEach } from "vitest";
import { createRoot as clientRoot, flush } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig as clientSharedConfig,
  createMemo as clientMemo,
  createProjection as clientProjection,
  createStore as clientStore,
  createOptimisticStore as clientOptimisticStore
} from "../src/client/hydration.js";
import {
  createRoot as serverRoot,
  createMemo as serverMemo,
  createProjection as serverProjection,
  createStore as serverStore,
  createOptimisticStore as serverOptimisticStore
} from "../src/server/index.js";
import { sharedConfig as serverSharedConfig } from "../src/server/shared.js";

enableHydration();

type Row = { id: number; t: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function createServerContext() {
  const serialized = new Map<string, any>();
  const context: any = {
    async: true,
    serialize(id: string, value: any) {
      serialized.set(id, value);
    }
  };
  return { context, serialized };
}

function startClientHydration(data: Record<string, any>) {
  clientSharedConfig.hydrating = true;
  clientSharedConfig.done = false;
  (clientSharedConfig as any).has = (id: string) => id in data;
  (clientSharedConfig as any).load = (id: string) => data[id];
  (clientSharedConfig as any).gather = () => {};
}

function stopClientHydration() {
  clientSharedConfig.hydrating = false;
  clientSharedConfig.done = true;
  (clientSharedConfig as any).has = undefined;
  (clientSharedConfig as any).load = undefined;
  (clientSharedConfig as any).gather = undefined;
}

describe("#5146: hydrated projection over an async store follows its source", () => {
  afterEach(() => {
    serverSharedConfig.context = undefined;
    stopClientHydration();
  });

  test("createProjection(() => truth) does not serialize and follows writes to truth after hydration", async () => {
    const { context, serialized } = createServerContext();
    serverSharedConfig.context = context;

    const d = deferred<Row[]>();
    let serverView!: Row[];
    serverRoot(
      () => {
        const [truth] = serverStore(() => d.promise, [] as Row[], { key: "id" } as any);
        serverView = serverProjection((() => truth) as any, [] as Row[], { key: "id" } as any);
      },
      { id: "r" }
    );

    d.resolve([
      { id: 1, t: "A" },
      { id: 2, t: "B" }
    ]);
    await tick();
    await tick();

    expect(serverView.map(r => r.t).join(",")).toBe("A,B");
    // Only the async source store serializes; the sync projection over it does not.
    expect(serialized.size).toBe(1);

    const wireData: Record<string, any> = {};
    for (const [k, v] of serialized.entries()) wireData[k] = v;

    startClientHydration(wireData);
    let setTruth!: (fn: (d: Row[]) => void) => void;
    let clientView!: Row[];
    let dispose!: () => void;

    clientRoot(
      d => {
        dispose = d;
        const [truth, _setTruth] = clientStore(
          async (): Promise<Row[]> => {
            throw new Error("should not re-fetch on client");
          },
          [] as Row[],
          { key: "id" }
        );
        setTruth = _setTruth;
        clientView = clientProjection((() => truth) as any, [] as Row[], { key: "id" });
      },
      { id: "r" }
    );

    flush();
    expect(clientView.map(r => r.t).join(",")).toBe("A,B");
    stopClientHydration();

    setTruth(draft => {
      draft[0].t = "Y";
    });
    flush();

    expect(clientView.map(r => r.t).join(",")).toBe("Y,B");
    dispose();
  });

  test("createOptimisticStore(() => truth) does not serialize and follows writes to truth after hydration", async () => {
    const { context, serialized } = createServerContext();
    serverSharedConfig.context = context;

    const d = deferred<Row[]>();
    let serverView!: Row[];
    serverRoot(
      () => {
        const [truth] = serverStore(() => d.promise, [] as Row[], { key: "id" } as any);
        const [view] = serverOptimisticStore(
          (() => truth) as any,
          [] as Row[],
          {
            key: "id"
          } as any
        );
        serverView = view;
      },
      { id: "r" }
    );

    d.resolve([
      { id: 1, t: "A" },
      { id: 2, t: "B" }
    ]);
    await tick();
    await tick();

    expect(serverView.map(r => r.t).join(",")).toBe("A,B");
    expect(serialized.size).toBe(1);

    const wireData: Record<string, any> = {};
    for (const [k, v] of serialized.entries()) wireData[k] = v;

    startClientHydration(wireData);
    let setTruth!: (fn: (d: Row[]) => void) => void;
    let clientView!: Row[];
    let dispose!: () => void;

    clientRoot(
      d => {
        dispose = d;
        const [truth, _setTruth] = clientStore(
          async (): Promise<Row[]> => {
            throw new Error("should not re-fetch on client");
          },
          [] as Row[],
          { key: "id" }
        );
        setTruth = _setTruth;
        const [view] = clientOptimisticStore((() => truth) as any, [] as Row[], { key: "id" });
        clientView = view;
      },
      { id: "r" }
    );

    flush();
    expect(clientView.map(r => r.t).join(",")).toBe("A,B");
    stopClientHydration();

    setTruth(draft => {
      draft[0].t = "Y";
    });
    flush();

    expect(clientView.map(r => r.t).join(",")).toBe("Y,B");
    dispose();
  });

  test("createProjection(() => truth) streaming hydration (pending source during hydrate) follows writes after settling", async () => {
    const { context, serialized } = createServerContext();
    serverSharedConfig.context = context;

    const serverD = deferred<Row[]>();
    serverRoot(
      () => {
        const [truth] = serverStore(() => serverD.promise, [] as Row[], { key: "id" } as any);
        serverProjection((() => truth) as any, [] as Row[], { key: "id" } as any);
      },
      { id: "r" }
    );

    // Source is still pending when the client starts hydrating.
    expect(serialized.size).toBe(1);
    const wireData: Record<string, any> = {};
    for (const [k, v] of serialized.entries()) wireData[k] = v;

    startClientHydration(wireData);
    let setTruth!: (fn: (d: Row[]) => void) => void;
    let clientView!: Row[];
    let dispose!: () => void;

    clientRoot(
      d => {
        dispose = d;
        const [truth, _setTruth] = clientStore(
          async (): Promise<Row[]> => {
            throw new Error("should not re-fetch on client");
          },
          [] as Row[],
          { key: "id" }
        );
        setTruth = _setTruth;
        clientView = clientProjection((() => truth) as any, [] as Row[], { key: "id" });
      },
      { id: "r" }
    );

    serverD.resolve([
      { id: 1, t: "A" },
      { id: 2, t: "B" }
    ]);
    await tick();
    await tick();
    flush();

    expect(clientView.map(r => r.t).join(",")).toBe("A,B");
    stopClientHydration();

    setTruth(draft => {
      draft[0].t = "Y";
    });
    flush();

    expect(clientView.map(r => r.t).join(",")).toBe("Y,B");
    dispose();
  });

  test("createProjection whose retry returns a Promise still serializes and does not re-fetch on hydration", async () => {
    const { context, serialized } = createServerContext();
    serverSharedConfig.context = context;

    const idD = deferred<number>();
    const rowsD = deferred<Row[]>();
    let serverView!: Row[];

    serverRoot(
      () => {
        const id = serverMemo(() => idD.promise);
        serverView = serverProjection(
          () => {
            const currentId = id();
            return rowsD.promise.then(rows => rows.map(r => ({ ...r, id: r.id + currentId! })));
          },
          [] as Row[],
          { key: "id" } as any
        );
      },
      { id: "r" }
    );

    idD.resolve(10);
    await tick();
    rowsD.resolve([{ id: 1, t: "A" }]);
    await tick();
    await tick();

    expect(serverView.map(r => `${r.id}:${r.t}`).join(",")).toBe("11:A");
    // Both the async memo and the async projection must serialize.
    expect(serialized.size).toBe(2);

    const wireData: Record<string, any> = {};
    for (const [k, v] of serialized.entries()) wireData[k] = v;

    startClientHydration(wireData);
    let clientFetches = 0;
    let clientView!: Row[];
    let dispose!: () => void;

    clientRoot(
      d => {
        dispose = d;
        const id = clientMemo(async () => 10);
        clientView = clientProjection(
          () => {
            const currentId = id();
            clientFetches++;
            return Promise.resolve([{ id: 1 + currentId!, t: "CLIENT" }]);
          },
          [] as Row[],
          { key: "id" }
        );
      },
      { id: "r" }
    );

    flush();
    expect(clientView.map(r => `${r.id}:${r.t}`).join(",")).toBe("11:A");
    // subFetch runs the trace once under mocked Promise; real value is the server's.
    expect(clientFetches).toBeLessThanOrEqual(1);
    dispose();
  });

  test("createProjection with seedLoadingValue over a pending store still serializes", async () => {
    const { context, serialized } = createServerContext();
    serverSharedConfig.context = context;

    const d = deferred<Row[]>();
    let serverView!: Row[];
    serverRoot(
      () => {
        const [truth] = serverStore(() => d.promise, [] as Row[], { key: "id" } as any);
        serverView = serverProjection(
          (() => truth) as any,
          [] as Row[],
          {
            key: "id",
            seedLoadingValue: true
          } as any
        );
      },
      { id: "r" }
    );

    // Commit #0 served the seed, so the projection's landing must serialize.
    expect(serverView.length).toBe(0);
    expect(serialized.size).toBe(2);

    d.resolve([{ id: 1, t: "A" }]);
    await tick();
    await tick();
  });
});
