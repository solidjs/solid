import { getOwner } from "@solidjs/signals";

export type HydrationContext = {};

type SharedConfig = {
  hydrating?: boolean;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | any;
  has?: (id: string) => boolean;
  gather?: (key: string) => void;
  registry?: Map<string, Element>;
  done?: boolean;
  count?: number;
  // effects?: Computation<any, any>[];
  // getContextId(): string;
  getNextContextId(): string;
};

export const sharedConfig: SharedConfig = {
  hydrating: false,
  registry: undefined,
  // effects: undefined,
  done: false,
  getNextContextId() {
    const o = getOwner();
    if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    return o.getNextChildId();
  }
};
