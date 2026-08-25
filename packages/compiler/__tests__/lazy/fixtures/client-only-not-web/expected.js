import { clientOnly } from "@solidjs/start";
import { clientOnly as webClientOnly } from "@solidjs/web";
const A = clientOnly(() => import("./A"));
const B = webClientOnly(() => import("./B"));
export default [A, B];
