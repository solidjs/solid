import { sample } from "../reactive/signal";

type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element;

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
  props: T,
  dynamicKeys?: string[]
): JSX.Element {
  if (dynamicKeys) {
    for (let i = 0; i < dynamicKeys.length; i++) dynamicProperty(props, dynamicKeys[i]);
  }
  return sample(() => Comp(props));
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
