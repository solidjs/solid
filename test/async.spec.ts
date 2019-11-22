import { createRoot, createSignal, loadResource, Resource } from "../src";

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    result: Resource<string>;
  function fetcher(id: number) {
    return !!id ? new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    }) : undefined;
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      trigger = setId;
      result = loadResource(() => fetcher(id()));
    });
    expect(result.data).toBeUndefined();
    expect(result.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(result.data).toBe("John");
    expect(result.loading).toBe(false);
    done();
  });

  test("test out of order", async done => {
    trigger(2);
    expect(result.loading).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    expect(result.data).toBe("Jake");
    expect(result.loading).toBe(false);
    result.reload(200);
    expect(result.loading).toBe(true);
    setTimeout(async () => {
      const resolve3 = resolve;
      resolve3("Jack");
      await Promise.resolve();
      expect(result.data).toBe("Jack");
      expect(result.loading).toBe(false);
      done();
    }, 300);
  });

  test("promise rejection", async done =>{
    trigger(4);
    expect(result.loading).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    await Promise.resolve();
    expect(result.loading).toBe(false);
    expect(result.error).toBe("Because I said so");
    expect(result.failedAttempts).toBe(1);
    done();
  });

  test("no promise", () => {
    trigger(0);
    expect(result.loading).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.failedAttempts).toBe(0);
  })
});

describe("using Context with no root", () => {
  test("loads default value", () => {
    expect(() => {
      let resolve: (v: string) => void;
      loadResource(() => new Promise(r => (resolve = r)));
      resolve!("Hi");
    }).not.toThrow();
  });
});
