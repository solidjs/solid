"use strict";
import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const secret = process.env.SECRET;
const serverFunction_1 = registerServerReference_1("964a320c-0", async () => "pong" + secret);
export const ping = createServerReference_1(serverFunction_1);
