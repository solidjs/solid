export function Variadic(...args) {
  return args;
}
export const VariadicArrow = (...args) => args.length;
export const VariadicExpression = function (...args) {
  return args[0];
};
export function Component(props) {
  return <div>{Variadic(1, 2, 3).length}</div>;
}
