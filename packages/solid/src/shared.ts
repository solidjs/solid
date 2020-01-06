// need to share context with DOM runtime without importing it
type HydrationContext = {
  id: string;
  count: number;
  registry?: Map<string, Element>;
};

export const runtimeConfig: { hydrate?: HydrationContext } = {};
export function setHydrateContext(context?: HydrationContext): void {
  runtimeConfig.hydrate = context;
}
export function nextHydrateContext(): HydrationContext | undefined {
  return runtimeConfig.hydrate
    ? {
        id: `${runtimeConfig.hydrate.id}.${runtimeConfig.hydrate.count++}`,
        count: 0,
        registry: runtimeConfig.hydrate.registry
      }
    : undefined;
}
