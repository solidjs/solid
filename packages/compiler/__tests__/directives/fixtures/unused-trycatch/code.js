import { connect } from "./db";
import { logError } from "./log";

// Module-level try/catch orphaned by the rewrite: the declarator inside the
// try goes (its only read lived in the replaced body), the try/catch itself
// and its catch binding stay (Babel never removes catch clauses).
try {
  var conn = connect();
} catch (error) {
  logError(error);
}

export const save = async data => {
  "use server";
  // Server-fn-internal try/catch with an unused catch binding (SolidStart's
  // server-function-unused-trycatch e2e shape): replaced wholesale on the
  // client, kept verbatim on the server.
  try {
    return conn.save(data);
  } catch (error) {
    return false;
  }
};

export const keep = () => true;
