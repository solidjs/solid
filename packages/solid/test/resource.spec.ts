import { createRoot, createSignal, load } from "../src";

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    loading: () => boolean,
    reload: () => void,
    value: string | undefined,
    error: String,
    failedAttempts: number;
  function fetcher(id: number) {
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
      trigger = setId;
      [loading, reload] = load(
        () => fetcher(id()),
        v => (value = v),
        (e, f) => {
          error = e;
          failedAttempts = f;
        }
      );
    });
    expect(value).toBeUndefined();
    expect(loading()).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value).toBe("John");
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
    expect(value).toBe("Jake");
    expect(loading()).toBe(false);
    reload();
    expect(loading()).toBe(true);
    setTimeout(async () => {
      const resolve3 = resolve;
      resolve3("Jack");
      await Promise.resolve();
      expect(value).toBe("Jack");
      expect(loading()).toBe(false);
      done();
    });
  });

  test("promise rejection", async done => {
    trigger(4);
    expect(loading()).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    await Promise.resolve();
    expect(loading()).toBe(false);
    expect(error).toBe("Because I said so");
    expect(failedAttempts).toBe(1);
    done();
  });

  test("no promise", () => {
    trigger(0);
    expect(loading()).toBe(false);
    expect(value).toBeUndefined();
  });
});

describe("using Context with no root", () => {
  test("loads default value", () => {
    expect(() => {
      let resolve: (v: string) => void;
      load(
        () => new Promise(r => (resolve = r)),
        v => {}
      );
      resolve!("Hi");
    }).not.toThrow();
  });
});
