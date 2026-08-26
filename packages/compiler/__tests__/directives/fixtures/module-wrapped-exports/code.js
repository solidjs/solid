"use server";

// Export-value registration: each export's *evaluated value* is the server
// function, so server-side wrappers (validation, logging, mock delays)
// compose onto every call path — HTTP dispatch and in-process SSR calls
// alike. The client build never sees any of this module: every export is a
// bare network reference.
import { withValidation, withDelay } from "./wrappers.js";
import { userSchema } from "./schema.js";
import { saveToDb } from "./db.js";

export const getUser = withValidation(userSchema, async id => {
  return { id };
});

async function saveUserImpl(user) {
  await saveToDb(user);
  return user;
}

const impl = withDelay(saveUserImpl, 400);
const alias = impl;
export { alias as saveUser };

export const plain = async () => "plain";

export default withDelay(async () => "mocked", 400);
