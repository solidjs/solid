import { db } from "./db";

export const run = async q => {
  "use server";
  return db.query(q);
};

export function inspect(expr) {
  return eval(expr);
}
