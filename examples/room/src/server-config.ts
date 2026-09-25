// Evaluated in the server-function handler graph before any dispatch (see
// `serverFunctions.configure` in vite.config.ts). Production needs nothing
// configured for live sources. The one option here is the dev chaos knob:
// with CHAOS_EVERY=<ms> the server ends EVERY live response after that many
// milliseconds exactly as a dying connection would (body closed with
// deferreds open), so the reconnect path runs continuously without a
// network to break. It is inert outside the dev build.
//
//   CHAOS_EVERY=2500 pnpm dev
//
// is the setting that keeps the room card from ever completing (its
// activity stream needs four seconds) — you watch it re-yield forever.
import { configureServerFunctionsServer } from "@solidjs/web/server-functions/server";

configureServerFunctionsServer({
  chaosReconnectEvery: Number(process.env.CHAOS_EVERY || 0)
});
