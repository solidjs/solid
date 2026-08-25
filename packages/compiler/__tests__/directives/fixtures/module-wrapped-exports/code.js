"use server";
import { GET, withMeta, wrap, serverOnly } from "./wrappers";
import { db } from "./db";

const cache = true;
const metadata = { cache };

export const getUser = withMeta(GET(async id => db.users.find(id)), metadata);

const save = wrap(async function saveUser(user) {
  return db.users.save(user);
});

export { save as saveUser };
