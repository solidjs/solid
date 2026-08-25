/**
 * Node-side driver for the browser bridge. Playwright is typed structurally
 * (anything with a compatible `evaluate`) so it never becomes a dependency —
 * the same adapter drives any page-like object that can round-trip
 * serializable values into the app's realm.
 *
 * NOTE: only type-level imports from `@solidjs/signals` are allowed here.
 * The app's signals instance lives in the page; importing it in Node would
 * create a second, unrelated instance.
 */
import { ARTIFACT_FORMAT_VERSION } from "./artifact.js";
import type { BridgeBeginOptions, BridgePayload } from "./browser.js";
import type { DiagnosticsArtifact } from "./types.js";

/** Structural subset of playwright's Page that the adapter needs. */
export interface EvaluatingPage {
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R, arg: Arg): Promise<R>;
  evaluate<R>(pageFunction: () => R): Promise<R>;
}

export interface BrowserCaptureOptions extends BridgeBeginOptions {
  scenario?: string;
}

export interface BrowserCaptureResult<T> {
  result: T;
  artifact: DiagnosticsArtifact;
}

/**
 * Capture a scripted browser interaction into a diagnostics artifact — the
 * same format `captureArtifact` produces in-process, so every assertion and
 * budget works unchanged on browser-captured evidence.
 */
export async function captureBrowserArtifact<T>(
  page: EvaluatingPage,
  interact: (page: EvaluatingPage) => T | Promise<T>,
  options: BrowserCaptureOptions = {}
): Promise<BrowserCaptureResult<T>> {
  await page.evaluate(
    beginOptions => {
      const bridge = (globalThis as Record<string, any>)["__SOLID_DIAGNOSTICS__"];
      if (!bridge) {
        throw new Error(
          '@solidjs/diagnostics bridge not found in the page. Import "@solidjs/diagnostics/browser" ' +
            "from your dev entry and call installDiagnosticsBridge()."
        );
      }
      bridge.begin(beginOptions);
    },
    { attribution: options.attribution } as BridgeBeginOptions
  );

  let result: T;
  try {
    result = await interact(page);
  } catch (error) {
    // Tear the session down so a failed interaction doesn't poison the next.
    await page
      .evaluate(() => {
        const bridge = (globalThis as Record<string, any>)["__SOLID_DIAGNOSTICS__"];
        if (bridge?.active()) bridge.end();
      })
      .catch(() => {});
    throw error;
  }

  const payload = await page.evaluate(() => {
    const bridge = (globalThis as Record<string, any>)["__SOLID_DIAGNOSTICS__"];
    return bridge.end() as BridgePayload;
  });

  return {
    result,
    artifact: {
      formatVersion: ARTIFACT_FORMAT_VERSION,
      scenario: options.scenario,
      capturedAt: payload.capturedAt,
      durationMs: payload.durationMs,
      diagnostics: payload.diagnostics,
      attribution: payload.attribution
    }
  };
}
