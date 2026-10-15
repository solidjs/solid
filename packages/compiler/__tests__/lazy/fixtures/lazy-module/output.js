import { lazy, lazyModule } from "solid-js";
const Page = lazy(() => import("./Page"), void 0, "__SOLID_LAZY_MODULE__:./Page");
const admin = lazyModule(() => import("./admin/routes"), "__SOLID_LAZY_MODULE__:./admin/routes");
export function load(path) {
	const nested = lazyModule(() => {
		return import("./nested");
	}, "__SOLID_LAZY_MODULE__:./nested");
	// Computed specifier: the pass cannot see it.
	const dynamic = lazyModule(() => import(path));
	// Already annotated: left untouched.
	const marked = lazyModule(() => import("./marked"), "keep");
	function scope() {
		// Local shadowing wins.
		const lazyModule = (fn) => fn;
		return lazyModule(() => import("./shadow"));
	}
	return [
		Page,
		admin,
		nested,
		dynamic,
		marked,
		scope
	];
}
