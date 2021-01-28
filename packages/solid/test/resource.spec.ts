import {
  createRoot,
  createSignal,
  createResource,
  createComputed,
  createState,
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

describe("Simulate a dynamic fetch with state and reconcile", () => {
  interface User {
    firstName: string;
    address: {
      streetNumber: number;
      streetName: string;
    };
  }
  let resolve: (v: User) => void,
    user: Resource<User>,
    load: (
      v: () => Promise<User> | User ,
      r?: (v: User, p: User) => User
    ) => void,
    state: { user?: User, userLoading: boolean },
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
      [user, load] = createResource<User>();
      [state] = createState<{ user?: User, userLoading: boolean }>({
        get user() {
          return user();
        },
        get userLoading() {
          return user.loading;
        }
      });
      createComputed(() => (state.user, count++));
    });
    load(fetcher);
    expect(state.user).toBeUndefined();
    expect(state.userLoading).toBe(true);
    resolve(data[0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.user).toStrictEqual(data[0]);
    expect(state.userLoading).toBe(false);
    expect(count).toBe(2);

    load(fetcher, (value, prev) => reconcile(value)(prev));
    expect(state.userLoading).toBe(true);
    resolve(data[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.user).toStrictEqual(data[0]);
    expect(state.user!.firstName).toBe("Joseph");
    expect(state.user!.address).toStrictEqual(data[0].address);
    expect(state.userLoading).toBe(false);
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
