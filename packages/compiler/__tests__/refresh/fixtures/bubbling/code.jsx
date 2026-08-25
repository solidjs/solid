const before = 1;
export function A3() {
  return before;
}
const mid = 2;
function B3() {
  return mid;
}
export default function C3() {
  return 3;
}
const after = 3;
export function D3() {
  return after;
}
export { B3 };
