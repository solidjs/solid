// Evaluated in the server-function handler graph before any dispatch (see
// `serverFunctions.configure` in vite.config.ts). Production needs nothing
// configured for live sources. One option here is a dev knob: with
// CHAOS_EVERY=<ms> the server ends every live response after that many
// milliseconds, exactly as a dying connection would, so the reconnect path
// runs continuously without a network to break. It is inert outside the dev
// build.
//
//   CHAOS_EVERY=2500 pnpm dev
//
// The other option is where a refusal becomes an answer. The board's store
// throws `Rejected` for a write it will not make, worded for the person who
// asked. Every server function runs through `wrapInvocation`, so this one
// place marks those as safe to send (anything else crosses as a generic
// error) and answers 409: the request was fine, the board's state said no.
import { markSafeError, respond } from "@solidjs/web";
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";
import { Rejected } from "~/server/db";

const refuse = (err: unknown): never => {
  throw err instanceof Rejected ? respond(markSafeError(err), { status: 409 }) : err;
};

configureServerFunctionsServer({
  chaosReconnectEvery: Number(process.env.CHAOS_EVERY || 0),
  wrapInvocation(run) {
    try {
      const result = run();
      return result instanceof Promise ? result.catch(refuse) : result;
    } catch (err) {
      refuse(err);
    }
  }
});
