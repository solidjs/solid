import { createServerReference as createServerReference_1 } from "@solidjs/web/server-functions";
import { registerServerReference as registerServerReference_1 } from "@solidjs/web/server-functions";
const API = "/api/messages";
const serverFunction_1 = registerServerReference_1("2f561cbf-0-sendMessage", async text => {
  await fetch(API, {
    method: "POST",
    body: text
  });
}, "sendMessage");
export const sendMessage = createServerReference_1(serverFunction_1);
export const label = "chat";
