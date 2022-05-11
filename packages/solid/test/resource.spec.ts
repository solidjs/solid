import {
  createRoot,
  createSignal,
  createResource,
  createComputed,
  createRenderEffect,
  onError,
  Resource,
  ResourceFetcherInfo,
} from "../src";

import { createStore, reconcile, Store, unwrap } from "../store/src";

global.queueMicrotask = (fn) => Promise.resolve().then(fn);

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: string) => void,
    value: Resource<string | undefined>,
    error: string;
  function fetcher(id: string) {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal("1");
      trigger = setId;
      onError(e => (error = e));
      [value] = createResource(id, fetcher);
      createRenderEffect(value);
    });
    expect(value()).toBeUndefined();
    expect(value.latest).toBeUndefined();
    expect(value.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(value.latest).toBe("John");
    expect(value.loading).toBe(false);
    done();
  });

  test("test out of order", async done => {
    trigger("2");
    expect(value.loading).toBe(true);
    const resolve1 = resolve;
    trigger("3");
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    expect(value()).toBe("Jake");
    expect(value.loading).toBe(false);
    done();
  });

  test("promise rejection", async done => {
    trigger("4");
    expect(value.loading).toBe(true);
    expect(value.error).toBeUndefined();
    reject("Because I said so");
    await Promise.resolve();
    expect(error).toBe("Because I said so");
    expect(value.error).toBe("Because I said so");
    expect(value.loading).toBe(false);
    done();
  });
});

describe("Simulate a dynamic fetch with state and reconcile", () => {
  interface User {
    firstName: string;
    address: {
      streetNumber: number;
      streetName: string;
    };
  }
  let resolve: (v: User) => void,
    refetch: (info?: unknown) => void,
    user: Resource<User | undefined>,
    state: { user?: User; userLoading: boolean },
    count = 0;
  function fetcher(_: string, { value }: ResourceFetcherInfo<Store<User>>) {
    return new Promise<User>(r => {
      resolve = r;
    }).then(next => reconcile(next)(value!));
  }
  const data: User[] = [];
  data.push({ firstName: "John", address: { streetNumber: 4, streetName: "Grindel Rd" } });
  data.push({ ...data[0], firstName: "Joseph" });

  test("initial async resource", async done => {
    createRoot(() => {
      [user, { refetch }] = createResource(fetcher);
      [state] = createStore<{ user?: User; userLoading: boolean }>({
        get user() {
          return user();
        },
        get userLoading() {
          return user.loading;
        }
      });
      createComputed(() => (state.user, count++));
    });
    expect(state.user).toBeUndefined();
    expect(state.userLoading).toBe(true);
    resolve(data[0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(unwrap(state.user)).toStrictEqual(data[0]);
    expect(state.userLoading).toBe(false);
    expect(count).toBe(2);

    refetch();
    expect(state.userLoading).toBe(true);
    resolve(data[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(unwrap(state.user)).toStrictEqual(data[0]);
    expect(state.user!.firstName).toBe("Joseph");
    expect(unwrap(state.user!.address)).toStrictEqual(data[0].address);
    expect(state.userLoading).toBe(false);
    expect(count).toBe(2);
    done();
  });
});

describe("using Resource with no root", () => {
  test("loads default value", () => {
    expect(() => {
      let resolve: (v: string) => void;
      createResource("error", () => new Promise(r => (resolve = r)));
      resolve!("Hi");
    }).not.toThrow();
  });
});

describe("using Resource with initial Value", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: string) => void,
    value: Resource<string>,
    error: string;
  function fetcher(id: string) {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }
  test("loads default value", async () => {
    createRoot(() => {
      const [id, setId] = createSignal("1");
      trigger = setId;
      onError(e => (error = e));
      [value] = createResource(id, fetcher, { initialValue: "Loading" });
      createRenderEffect(value);
    });
    expect(value()).toBe("Loading");
    expect(value.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(value.loading).toBe(false);
  });
});
