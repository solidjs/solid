import {
  createRoot,
  createSignal,
  createResource,
  createRenderEffect,
  catchError,
  Resource,
  ResourceFetcherInfo,
  Signal,
  createMemo
} from "../src";

import { createStore, reconcile, ReconcileOptions, Store, unwrap } from "../store/src";

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: string) => void,
    value: Resource<string | undefined>,
    error: Error;
  function fetcher(id: string) {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }

  test("initial async resource", async () => {
    createRoot(() => {
      const [id, setId] = createSignal("1");
      trigger = setId;
      catchError(
        () => {
          [value] = createResource(id, fetcher);
          createRenderEffect(value);
        },
        e => (error = e)
      );
    });
    expect(value()).toBeUndefined();
    expect(value.latest).toBeUndefined();
    expect(value.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(value.latest).toBe("John");
    expect(value.loading).toBe(false);
  });

  test("test out of order", async () => {
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
  });

  test("promise rejection", async () => {
    trigger("4");
    expect(value.loading).toBe(true);
    expect(value.error).toBeUndefined();
    reject("Because I said so");
    await Promise.resolve();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Because I said so");
    expect(value.error).toBeInstanceOf(Error);
    expect(value.error.message).toBe("Because I said so");
    expect(value.loading).toBe(false);
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
  function fetcher(_: unknown, { value }: ResourceFetcherInfo<Store<User>>) {
    return new Promise<User>(r => {
      resolve = r;
    }).then(next => reconcile(next)(value!));
  }
  const data: User[] = [];
  data.push({ firstName: "John", address: { streetNumber: 4, streetName: "Grindel Rd" } });
  data.push({ ...data[0], firstName: "Joseph" });

  test("initial async resource", async () => {
    createRoot(async () => {
      [user, { refetch }] = createResource(fetcher);
      [state] = createStore<{ user?: User; userLoading: boolean }>({
        get user() {
          return user();
        },
        get userLoading() {
          return user.loading;
        }
      });
      createRenderEffect(() => (state.user, count++));
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
    expect(state.user?.firstName).toBe("Joseph");
    expect(unwrap(state.user?.address)).toStrictEqual(data[0].address);
    expect(state.userLoading).toBe(false);
    expect(count).toBe(2);
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
    error: Error;
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
      catchError(
        () => {
          [value] = createResource(id, fetcher, { initialValue: "Loading" });
          createRenderEffect(value);
        },
        e => (error = e)
      );
    });
    expect(value()).toBe("Loading");
    expect(value.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(value.loading).toBe(false);
  });
});

describe("using Resource with errors", () => {
  let resolve: (v: string) => void,
    reject: (e: any) => void,
    trigger: (v: string) => void,
    value: Resource<string | undefined>,
    error: Error;
  function fetcher(id: string) {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }
  test("works with falsy errors", async () => {
    createRoot(() => {
      const [id, setId] = createSignal("1");
      trigger = setId;
      catchError(
        () => {
          [value] = createResource(id, fetcher);
          createRenderEffect(value);
        },
        e => (error = e)
      );
    });
    expect(value()).toBeUndefined();
    expect(value.state === "pending").toBe(true);
    expect(value.error).toBeUndefined();
    reject(null);
    await Promise.resolve();
    expect(value.state === "errored").toBe(true);
    expect(value.error.message).toBe("Unknown error");
  });
});

describe("using Resource with custom store", () => {
  type User = {
    firstName: string;
    lastName: string;
    address: {
      streetNumber: number;
      streetName: string;
      city: string;
      state: string;
      zip: number;
    };
  };
  let resolve: (v: User) => void;
  let value: Resource<User>;
  function fetcher() {
    return new Promise<User>(r => {
      resolve = r;
    });
  }
  function createDeepSignal<T>(value: T, options?: ReconcileOptions): Signal<T> {
    const [store, setStore] = createStore({
      value
    });
    return [
      () => store.value,
      (v: T) => {
        const unwrapped = unwrap(store.value);
        typeof v === "function" && (v = v(unwrapped));
        setStore("value", reconcile(v, options));
        return store.value;
      }
    ] as Signal<T>;
  }
  test("loads and diffs", async () => {
    let first = 0;
    let last = 0;
    let addr = 0;
    let street = 0;
    createRoot(() => {
      [value] = createResource(fetcher, {
        initialValue: {
          firstName: "John",
          lastName: "Smith",
          address: {
            streetNumber: 4,
            streetName: "Grindel Rd",
            city: "New York",
            state: "NY",
            zip: 10001
          }
        },
        storage: createDeepSignal
      });
      createRenderEffect(() => (first++, value()?.firstName));
      createRenderEffect(() => (last++, value()?.lastName));
      const address = createMemo(() => (addr++, value()?.address));
      createRenderEffect(() => (street++, address()?.streetName));
    });
    expect(value()).toEqual({
      firstName: "John",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Grindel Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    expect(value.loading).toBe(true);
    expect(first).toBe(1);
    expect(last).toBe(1);
    expect(addr).toBe(1);
    expect(street).toBe(1);
    resolve({
      firstName: "Matt",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Central Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    await Promise.resolve();
    expect(value()).toEqual({
      firstName: "Matt",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Central Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    expect(value.loading).toBe(false);
    expect(first).toBe(2);
    expect(last).toBe(1);
    expect(addr).toBe(1);
    expect(street).toBe(2);
  });

  test("mutates", async () => {
    let first = 0;
    let last = 0;
    let addr = 0;
    let street = 0;
    let mutate: <T>(v: T) => T;
    createRoot(() => {
      [value, { mutate }] = createResource(false, fetcher, {
        initialValue: {
          firstName: "John",
          lastName: "Smith",
          address: {
            streetNumber: 4,
            streetName: "Grindel Rd",
            city: "New York",
            state: "NY",
            zip: 10001
          }
        },
        storage: createDeepSignal
      });
      createRenderEffect(() => (first++, value()?.firstName));
      createRenderEffect(() => (last++, value()?.lastName));
      const address = createMemo(() => (addr++, value()?.address));
      createRenderEffect(() => (street++, address()?.streetName));
    });
    expect(value()).toEqual({
      firstName: "John",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Grindel Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    expect(value.loading).toBe(false);
    expect(first).toBe(1);
    expect(last).toBe(1);
    expect(addr).toBe(1);
    expect(street).toBe(1);
    mutate!({
      firstName: "Matt",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Central Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    await Promise.resolve();
    expect(value()).toEqual({
      firstName: "Matt",
      lastName: "Smith",
      address: {
        streetNumber: 4,
        streetName: "Central Rd",
        city: "New York",
        state: "NY",
        zip: 10001
      }
    });
    expect(value.loading).toBe(false);
    expect(first).toBe(2);
    expect(last).toBe(1);
    expect(addr).toBe(1);
    expect(street).toBe(2);
  });
});
