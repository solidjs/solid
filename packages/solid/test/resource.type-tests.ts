import { createResource, ResourceReturn, createSignal, Resource, Setter } from "../src";
import { InitializedResource, InitializedResourceReturn } from "../src/reactive/signal";

type Assert<T extends true> = T;
// https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;

/* createResource inference tests */

// without source, initialValue
// with fetcher
{
  const resourceReturn = createResource(
    k => {
      return Promise.resolve(1);
      type Tests = Assert<Equals<typeof resourceReturn, ResourceReturn<number, unknown>>> &
        Assert<Equals<typeof k, true>>;
    },
    {
      storage: createSignal,
      name: "test",
      deferStream: true,
      onHydrated: (k, info) => {
        type Tests = Assert<Equals<typeof k, true | undefined>> &
          Assert<Equals<typeof info, { value: number | undefined }>>;
      }
    }
  );
}

// without source
// with fetcher, initialValue
{
  const resourceReturn = createResource(
    k => {
      return Promise.resolve(1);
      type Tests = Assert<
        Equals<typeof resourceReturn, InitializedResourceReturn<number, unknown>>
      > &
        Assert<Equals<typeof k, true>>;
    },
    {
      initialValue: 1,
      storage: createSignal,
      name: "test",
      deferStream: true,
      onHydrated: (k, info) => {
        type Tests = Assert<Equals<typeof k, true | undefined>> &
          Assert<Equals<typeof info, { value: number | undefined }>>;
      }
    }
  );

  type ResourceActions = (typeof resourceReturn)[1];
  type Tests = Assert<Equals<ResourceActions["mutate"], Setter<number>>>;
}

// without initialValue
// with source, fetcher
{
  const resourceReturn = createResource(
    () => 1,
    k => {
      return Promise.resolve(1);
      type Tests = Assert<Equals<typeof resourceReturn, ResourceReturn<number, unknown>>> &
        Assert<Equals<typeof k, number>>;
    },
    {
      storage: createSignal,
      name: "test",
      deferStream: true,
      onHydrated: (k, info) => {
        type Tests = Assert<Equals<typeof k, number | undefined>> &
          Assert<Equals<typeof info, { value: number | undefined }>>;
      }
    }
  );

  type ResourceActions = (typeof resourceReturn)[1];
  type Tests = Assert<Equals<ResourceActions["mutate"], Setter<number | undefined>>>;
}

// with source, fetcher, initialValue
{
  const resourceReturn = createResource(
    () => 1,
    k => {
      return Promise.resolve(1);
      type Tests = Assert<
        Equals<typeof resourceReturn, InitializedResourceReturn<number, unknown>>
      > &
        Assert<Equals<typeof k, number>>;
    },
    {
      initialValue: 1,
      storage: createSignal,
      name: "test",
      deferStream: true,
      onHydrated: (k, info) => {
        type Tests = Assert<Equals<typeof k, number | undefined>> &
          Assert<Equals<typeof info, { value: number | undefined }>>;
      }
    }
  );
}

/* Resource type tests */
{
  let resource!: Resource<string>;
  const resourceValue = resource();
  let initializedResource!: InitializedResource<string>;
  const initializedResourceValue = initializedResource();

  type Tests = Assert<Equals<typeof resourceValue, string | undefined>> &
    Assert<Equals<typeof initializedResourceValue, string>> &
    Assert<
      Equals<typeof resource.state, "errored" | "pending" | "ready" | "refreshing" | "unresolved">
    > &
    Assert<Equals<typeof initializedResource.state, "errored" | "ready" | "refreshing">>;

  switch (resource.state) {
    case "errored":
      const errorValue = resource();
      break;
    case "pending":
      const pendingValue = resource();
      break;
    case "ready":
      const readyValue = resource();
      break;
    case "refreshing":
      const refreshingValue = resource();
      break;
    case "unresolved":
      const unresolvedValue = resource();
      break;
      // this is weird but it works
      type Test = Assert<Equals<typeof errorValue, never>> &
        Assert<Equals<typeof pendingValue, undefined>> &
        Assert<Equals<typeof readyValue, string>> &
        Assert<Equals<typeof refreshingValue, string>> &
        Assert<Equals<typeof unresolvedValue, undefined>>;
  }

  switch (initializedResource.state) {
    case "errored":
      const errorValue = initializedResource();
      break;
    case "ready":
      const readyValue = initializedResource();
      break;
    case "refreshing":
      const refreshingValue = initializedResource();
      break;
      // this is weird but it works
      type Test = Assert<Equals<typeof errorValue, never>> &
        Assert<Equals<typeof readyValue, string>> &
        Assert<Equals<typeof refreshingValue, string>>;
  }
}
