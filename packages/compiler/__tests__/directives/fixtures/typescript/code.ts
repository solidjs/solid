"use server";
import { db } from "./db";

export const findUser = async (id: string): Promise<unknown> => {
  return db.users.find(id);
};

export function touch(id: string): void {
  db.users.touch(id);
}
