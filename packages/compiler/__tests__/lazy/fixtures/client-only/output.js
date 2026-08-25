import { clientOnly } from "@solidjs/web";
// Bare form: the options slot is padded with `void 0` so the placeholder
// always lands in the third argument.
const Chart = clientOnly(() => import("./Chart"), void 0, "__SOLID_LAZY_MODULE__:./Chart");
// Options form: the bag stays in place, the placeholder is appended.
const Map = clientOnly(() => import("./Map"), { lazy: true }, "__SOLID_LAZY_MODULE__:./Map");
export function widgets() {
	// Module-scope binding used from a nested scope still matches.
	const Inline = clientOnly(() => import("./Inline"), void 0, "__SOLID_LAZY_MODULE__:./Inline");
	return [
		Chart,
		Map,
		Inline
	];
}
// Already annotated (three arguments): left untouched.
const Annotated = clientOnly(() => import("./Annotated"), { lazy: true }, "resolved");
