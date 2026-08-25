import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
// A pruned import whose surviving specifiers are all type-only must go
// entirely: `import { type Session } from "./server-module"` emits no
// runtime binding but still loads the module — a server-code leak in the
// client bundle (solid-start #2273). A mixed import that keeps a live value
// specifier survives, type specifiers and all.
import { type Session, verify } from "./server-module";
import { type Meta, mixedValue, helper } from "./mixed-module";
export const value = mixedValue;
const serverFunction_1 = registerServerReference_1("31e1639f-0", async (): Promise<Session | null> => {
	return verify(helper());
});
export const serverAction = createServerReference_1(serverFunction_1);
