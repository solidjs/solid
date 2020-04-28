type PropsWithChildren<P> = P & { children?: JSX.Element };
export type Component<P = {}> = (props: PropsWithChildren<P>) => JSX.Element

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
