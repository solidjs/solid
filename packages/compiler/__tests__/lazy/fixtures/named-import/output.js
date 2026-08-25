import { lazy } from "solid-js";
const Home = lazy(() => import("./Home"), void 0, "__SOLID_LAZY_MODULE__:./Home");
// Options bag in second position: the placeholder pads into the third slot.
const AboutPage = lazy(() => import("./Pages"), { export: "AboutPage" }, "__SOLID_LAZY_MODULE__:./Pages");
export function routes() {
	// Module-scope binding used from a nested scope still matches.
	const About = lazy(() => import("./About"), void 0, "__SOLID_LAZY_MODULE__:./About");
	return [Home, About];
}
