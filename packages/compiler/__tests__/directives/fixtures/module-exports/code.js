"use server";
import { db } from "./db";

export async function getUser(id) {
  return db.users.find(id);
}

export const deleteUser = async id => {
  await db.users.delete(id);
};

const impl = async () => db.raw();
export { impl as runQuery };
export default getUser;
