// The single-script surfaces accept the render's `CSPNonce` as is. Compile-only,
// under `test-types`.
import { createSSRResponse, generateHydrationScript, HydrationScript } from "../src/server.js";
import type { CSPNonce } from "../src/server.js";

declare const nonce: CSPNonce;
generateHydrationScript({ nonce });
generateHydrationScript({ nonce: { script: "a", style: false } });
HydrationScript({ nonce });
createSSRResponse("<html></html>", undefined, { nonce });
