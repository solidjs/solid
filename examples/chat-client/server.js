// The production harness: static client assets, plus the built server
// bundle's `handleRequest` — a web `Request -> Response` that streams the
// SSR render and serves the `/_server` endpoint. The node <-> web plumbing
// below is the only glue.
//
// One thing it owes the app: a client that goes away must abort the
// request's `signal`. That is what reaches src/server/reply.ts as
// `getRequestEvent().request.signal`, and what stops the model when a reply
// is stopped or a tab is closed. (The dev server does the same.)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleRequest } from "./dist/server/server.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3012;

const MIME = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function webRequest(req, signal) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, {
    method,
    headers: req.headers,
    signal,
    body,
    ...(body ? { duplex: "half" } : {})
  });
}

createServer(async (req, res) => {
  const url = req.url || "/";

  if (url !== "/" && !url.includes("..")) {
    const file = url.split("?")[0];
    try {
      const content = readFileSync(path.resolve(root, "dist/client" + file));
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600"
      });
      return res.end(content);
    } catch {
      // Fall through to the handler (the page, /_server, ...).
    }
  }

  // The response's 'close' fires on completion too; `writableEnded` tells a
  // finished response from a client that went away.
  const gone = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) gone.abort();
  });
  try {
    const response = await handleRequest(webRequest(req, gone.signal));
    const cookies = response.headers.getSetCookie?.();
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") res.setHeader(key, value);
    });
    if (cookies?.length) res.setHeader("set-cookie", cookies);
    res.statusCode = response.status;
    if (response.body) {
      const reader = response.body.getReader();
      gone.signal.addEventListener("abort", () => reader.cancel().catch(() => {}), { once: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (e) {
    // The client went away mid-response: nothing to report.
    if (gone.signal.aborted) return res.destroy();
    console.error(e);
    res.statusCode = 500;
    res.end(e.message);
  }
}).listen(PORT, () => {
  console.log(`Chat (client-owned) on http://localhost:${PORT}`);
});
