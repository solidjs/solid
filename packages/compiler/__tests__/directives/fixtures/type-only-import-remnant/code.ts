// A pruned import whose surviving specifiers are all type-only must go
// entirely: `import { type Session } from "./server-module"` emits no
// runtime binding but still loads the module — a server-code leak in the
// client bundle (solid-start #2273). A mixed import that keeps a live value
// specifier survives, type specifiers and all.
import { type Session, verify } from "./server-module";
import { type Meta, mixedValue, helper } from "./mixed-module";

export const value = mixedValue;

export const serverAction = async (): Promise<Session | null> => {
  "use server";
  return verify(helper());
};
