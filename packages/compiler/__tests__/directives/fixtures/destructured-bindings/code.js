import { createClient } from "./db";
import { loadConfig } from "./config";

const { db } = createClient(loadConfig());
const { site, secret } = loadConfig();

export const remove = async id => {
  "use server";
  await db.delete(id, secret);
};

export const title = site.name;
