import { startTimer } from "./metrics";
import { connect } from "./db";

// Pre-existing dead code: written for its side effect, never referenced.
const t = startTimer();
const URL = "postgres://localhost";
const conn = connect(URL);

export const save = async data => {
  "use server";
  return conn.insert(data);
};
