type HydrationContext = { id: string; count: number; loadResource?: (id: string) => Promise<any> };

type SharedConfig = {
  context?: HydrationContext;
  resources?: { [key: string]: any };
  registry?: Map<string, Element>;
};

export const sharedConfig: SharedConfig = {};

export function setHydrateContext(context?: HydrationContext): void {
  sharedConfig.context = context;
}

export function nextHydrateContext(): HydrationContext | undefined {
  return {
    ...sharedConfig.context,
    id: `${sharedConfig.context!.id}${sharedConfig.context!.count++}.`,
    count: 0
  };
}
