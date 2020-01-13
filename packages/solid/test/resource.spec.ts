import {
  createRoot,
  createSignal,
  createResource,
  createResourceState,
  createEffect
} from "../src";

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    loading: () => boolean,
    load: (v: Promise<string> | undefined) => () => boolean,
    value: () => string | undefined;
  function fetcher(id: number): Promise<string> | undefined {
    return !!id
      ? new Promise<string>((r, f) => {
          resolve = r;
          reject = f;
        })
      : undefined;
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      [value, load] = createResource<string>();
      trigger = setId;
      createEffect(() => {
        loading = load(fetcher(id()));
      });
    });
    expect(value()).toBeUndefined();
    expect(loading()).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(loading()).toBe(false);
    done();
  });

  test("test out of order", async done => {
    trigger(2);
    expect(loading()).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    expect(value()).toBe("Jake");
    expect(loading()).toBe(false);
    done();
  });

  test("promise rejection", async done => {
    trigger(4);
    expect(loading()).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    await Promise.resolve();
    expect(loading()).toBe(false);
    done();
  });

  test("no promise", () => {
    trigger(0);
    expect(loading()).toBe(false);
    expect(value()).toBeUndefined();
  });
});

describe("Simulate a dynamic fetch with state", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    loading: () => boolean,
    load: (
      k: number,
      v: Promise<string> | string | undefined,
      r?: (v: any) => (state: any) => void
    ) => () => boolean,
    setUsers: Function,
    users: any;
  function fetcher(): Promise<string> {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      [users, load, setUsers] = createResourceState<{ [id: number]: string }>(
        {}
      );
      trigger = setId;
      createEffect(() => {
        const i = id();
        if (i === 5) return (loading = load(5, "Jordan"));
        loading = load(i, fetcher());
      });
    });
    expect(users[1]).toBeUndefined();
    expect(loading()).toBe(true);
    resolve("John");
    await Promise.resolve();
    await Promise.resolve();
    expect(users[1]).toBe("John");
    expect(loading()).toBe(false);
    done();
  });

  test("test multiple loads", async done => {
    trigger(2);
    expect(loading()).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    await Promise.resolve();
    expect(users[3]).toBe("Jake");
    expect(loading()).toBe(false);
    done();
  });

  test("promise rejection", async done => {
    trigger(4);
    expect(loading()).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(loading()).toBe(false);
    done();
  });

  test("direct value", () => {
    trigger(5);
    expect(loading()).toBe(false);
    expect(users[5]).toBe("Jordan");
  });

  test("setState", () => {
    setUsers("5", "Jordy");
    expect(users[5]).toBe("Jordy");
  });

  test("custom reconciler", async done => {
    const reconcile = (v: any) => (state: any) => {
      state[6] = v[6] + "l";
    };
    load(6, new Promise(r => r("Jerry")), reconcile);
    await Promise.resolve();
    await Promise.resolve();
    expect(users[6]).toBe("Jerryl");
    done();
  });
});

describe("using Context with no root", () => {
  test("loads default value", () => {
    expect(() => {
      const [, load] = createResource<string>();
      let resolve: (v: string) => void;
      load(new Promise(r => (resolve = r)));
      resolve!("Hi");
    }).not.toThrow();
  });
});
