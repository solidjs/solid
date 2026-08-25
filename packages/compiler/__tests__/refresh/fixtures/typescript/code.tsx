interface P {
  n?: number;
}
type Alias = string;
export const App = <T,>(props: P & { list: T[] }): any => {
  const map: Record<string, Alias[]> = {};
  const fn = (x: number): string => String(x);
  const tup: [number, string] = [1, 'a'];
  const un: 'a' | 'b' | null = null;
  const idx: P['n'] = props.n!;
  const q: typeof map = map;
  const ro: readonly string[] = [];
  return <div>{props.list.length as unknown as string}</div>;
};
