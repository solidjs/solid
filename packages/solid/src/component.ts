export function setDefaults<T>(props: Partial<T>, defaultProps: Partial<T>) {
  const propKeys = Object.keys(defaultProps) as (keyof T)[];
  for (let i = 0; i < propKeys.length; i++) {
    const key = propKeys[i];
    !(key in props) && (props[key] = defaultProps[key]);
  }
}
