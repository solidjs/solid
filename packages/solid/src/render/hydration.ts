export type HydrationContext = { id: string; count: number; };

type SharedConfig = {
  context?: HydrationContext;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | undefined;
  gather?: (key: string) => void;
  registry?: Map<string, Element>;
};

export const sharedConfig: SharedConfig = {};

export function setHydrateContext(context?: HydrationContext): void {
  sharedConfig.context = context;
}

export function nextHydrateContext(): HydrationContext | undefined {
  return {
    ...sharedConfig.context,
    id: `${sharedConfig.context!.id}${sharedConfig.context!.count++}-`,
    count: 0
  };
}
