import { lazy } from "solid-js";
const Home = lazy(() => import("./Home"), void 0, "__SOLID_LAZY_MODULE__:./Home");
const AboutPage = lazy(() => import("./Pages"), {
  export: "AboutPage"
}, "__SOLID_LAZY_MODULE__:./Pages");
export function routes() {
  const About = lazy(() => import("./About"), void 0, "__SOLID_LAZY_MODULE__:./About");
  return [Home, About];
}
