import {
  createRoot,
  createSignal,
  createResource,
  createResourceState,
  createComputed,
  createRenderEffect,
  onError,
  SetStateFunction,
  Resource,
  State,
  reconcile
} from "../src";

describe("Simulate a dynamic fetch", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    load: (v: () => Promise<string>) => void,
    i: number,
    value: Resource<string>,
    error: string;
  function fetcher(id: number) {
    return () =>
      new Promise<string>((r, f) => {
        resolve = r;
        reject = f;
      });
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      [value, load] = createResource<string>();
      trigger = setId;
      onError(e => (error = e));
      createComputed(() => (i = id()) && load(fetcher(i)));
      createRenderEffect(value);
    });
    expect(value()).toBeUndefined();
    expect(value.loading).toBe(true);
    resolve("John");
    await Promise.resolve();
    expect(value()).toBe("John");
    expect(value.loading).toBe(false);
    done();
  });

  test("test out of order", async done => {
    trigger(2);
    expect(value.loading).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    expect(value()).toBe("Jake");
    expect(value.loading).toBe(false);
    done();
  });

  test("promise rejection", async done => {
    trigger(4);
    expect(value.loading).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    expect(error).toBe("Because I said so");
    expect(value.loading).toBe(false);
    done();
  });
});

describe("Simulate a dynamic fetch with state", () => {
  let resolve: (v: string) => void,
    reject: (r: string) => void,
    trigger: (v: number) => void,
    load: (
      v: { [k: number]: () => Promise<string> | string },
      r?: (v: any) => (state: any) => void
    ) => void,
    setUsers: SetStateFunction<{ [id: number]: string }>,
    users: State<{ [id: number]: string; loading: { [id: number]: boolean } }>,
    count = 0;
  function fetcher(): Promise<string> {
    return new Promise<string>((r, f) => {
      resolve = r;
      reject = f;
    });
  }

  test("initial async resource", async done => {
    createRoot(() => {
      const [id, setId] = createSignal(1);
      [users, load, setUsers] = createResourceState<{ [id: number]: string }>({ 6: "Rio" });
      trigger = setId;
      createComputed(() => load({ [id()]: fetcher }));
      createComputed(() => (users[5], count++));
    });
    expect(users[1]).toBeUndefined();
    expect(users.loading[1]).toBe(true);
    resolve("John");
    await Promise.resolve();
    await Promise.resolve();
    expect(users[1]).toBe("John");
    expect(users.loading[1]).toBe(false);
    done();
  });

  test("test multiple loads", async done => {
    trigger(2);
    expect(users.loading[2]).toBe(true);
    const resolve1 = resolve;
    trigger(3);
    const resolve2 = resolve;
    resolve2("Jake");
    resolve1("Jo");
    await Promise.resolve();
    await Promise.resolve();
    expect(users[3]).toBe("Jake");
    expect(users.loading[3]).toBe(false);
    done();
  });

  test("promise rejection", async done => {
    trigger(4);
    expect(users.loading[4]).toBe(true);
    reject("Because I said so");
    await Promise.resolve();
    await Promise.resolve();
    expect(users.loading[4]).toBe(false);
    done();
  });

  test("setState", () => {
    setUsers(5, "Jordy");
    expect(users[5]).toBe("Jordy");
    expect(count).toBe(2);
  });

  test("test loading same value", () => {
    load({ 5: () => "Jordy" });
    expect(users[5]).toBe("Jordy");
    expect(count).toBe(2);
  });

  test("custom reconciler", async done => {
    const reconcile = (v: string) => (state: string) => `${state} ${v}`;
    load({ 6: () => new Promise(r => r("Jerry")) }, reconcile);
    await Promise.resolve();
    await Promise.resolve();
    expect(users[6]).toBe("Rio Jerry");
    done();
  });

  test("setState tracked", () => {
    createRoot(() => {
      let runs = 0;
      createComputed(() => {
        users[7];
        runs++;
      });
      expect(runs).toBe(1);
      setUsers({ 7: "Jimbo" });
      expect(users[7]).toBe("Jimbo");
      expect(runs).toBe(2);
    });
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
    load: (
      v: { [k: number]: () => Promise<User> | User },
      r?: (v: any) => (state: any) => void
    ) => void,
    users: State<{ [id: number]: User; loading: { [id: number]: boolean } }>,
    count = 0;
  function fetcher() {
    return new Promise<User>(r => {
      resolve = r;
    });
  }
  const data: User[] = [];
  data.push({ firstName: "John", address: { streetNumber: 4, streetName: "Grindel Rd" } })
  data.push({ ...data[0], firstName: "Joseph" })

  test("initial async resource", async done => {
    createRoot(() => {
      [users, load] = createResourceState<{ [id: number]: User }>({});
      createComputed(() => (users[0], count++));
    });
    load({ 0: fetcher });
    expect(users[0]).toBeUndefined();
    expect(users.loading[0]).toBe(true);
    resolve(data[0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(users[0]).toStrictEqual(data[0]);
    expect(users.loading[0]).toBe(false);
    expect(count).toBe(2);

    load({ 0: fetcher }, reconcile);
    expect(users.loading[0]).toBe(true);
    resolve(data[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(users[0]).toStrictEqual(data[0]);
    expect(users[0].firstName).toBe("Joseph");
    expect(users[0].address).toStrictEqual(data[0].address);
    expect(users.loading[0]).toBe(false);
    expect(count).toBe(2);
    done();
  });
});

describe("using Resource with no root", () => {
  test("loads default value", () => {
    expect(() => {
      const [, load] = createResource<string>();
      let resolve: (v: string) => void;
      load(() => new Promise(r => (resolve = r)));
      resolve!("Hi");
    }).not.toThrow();
  });
});
