import { createRoot, createSignal, createResource, createEffect } from "../src";

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
      })
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
