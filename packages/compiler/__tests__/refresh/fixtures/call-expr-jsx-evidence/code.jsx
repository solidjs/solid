import { styled, local } from './styled';

// #3090 (native-first divergence from the frozen Babel reference): a
// call-shaped binding rendered as a JSX tag in THIS module is proven a
// component and registers like one — location, signature, dependencies.
export const Badge = styled.span.attrs({ title: "v1" })`color: red;`;
// Never rendered here except through a shadowing local below: no evidence,
// stays bare (a `@refresh component` pragma would register it).
export const Shadowed = styled.div`color: blue;`;

export function Legend() {
  return <p><Badge>in-module</Badge></p>;
}

export function Other() {
  const Shadowed = local();
  return <div><Shadowed /></div>;
}
