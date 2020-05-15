import { sample } from "../reactive/signal";

type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element;

type PossiblyWrapped<T> = {
  [P in keyof T]: T[P] | (() => T[P]);
};

function dynamicProperty(props: any, key: string) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
}

export function createComponent<T>(
  Comp: (props: T) => JSX.Element,
  props: PossiblyWrapped<T>,
  dynamicKeys?: (keyof T)[]
): JSX.Element {
  if (dynamicKeys) {
    for (let i = 0; i < dynamicKeys.length; i++) dynamicProperty(props, dynamicKeys[i] as string);
  }
  return sample(() => Comp(props as T));
}

export function setDefaults<T>(props: T, defaultProps: T) {
  const propKeys = Object.keys(defaultProps) as (keyof T)[];
  for (let i = 0; i < propKeys.length; i++) {
    const key = propKeys[i];
    !(key in props) && (props[key] = defaultProps[key]);
  }
}

export function cloneProps<T>(props: T): T {
  const clone = {},
    descriptors = Object.getOwnPropertyDescriptors(props);
  Object.defineProperties(clone, descriptors);
  return clone as T;
}

export function splitProps<T>(props: T, ...keys: [(keyof T)[]]) {
  const descriptors = Object.getOwnPropertyDescriptors(props),
    split = (k: (keyof T)[]) => {
      const clone: Partial<T> = {};
      for (let i = 0; i < k.length; i++) {
        const key = k[i];
        Object.defineProperty(clone, key, descriptors[key]);
        delete descriptors[key];
      }
      return clone;
    };
  return keys.map(split).concat(split(Object.keys(descriptors) as (keyof T)[]));
}
