export type HydrationContext = { id: string; count: number };

type SharedConfig = {
  context?: HydrationContext;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | any | undefined;
  gather?: (key: string) => void;
  registry?: Map<string, Element>;
  done?: boolean;
};

export const sharedConfig: SharedConfig = { context: undefined, registry: undefined };

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
