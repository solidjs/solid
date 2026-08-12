// Node harness for the streaming-SSR (renderToStream) mode. Dev runs Vite
// in middleware mode and SSR-loads ./entry-server.tsx; prod serves the built
// client assets and imports the built server entry. Modeled on
// @solidjs/vite-plugin's own SSR example server.
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 3000;

const MIME = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".ico": "image/x-icon"
};

function getClientEntry() {
  const manifest = JSON.parse(
    readFileSync(path.resolve(__dirname, "dist/client/.vite/manifest.json"), "utf-8")
  );
  return "/" + manifest["client.tsx"].file;
}

async function start() {
  let vite;

  const server = createHttpServer(async (req, res) => {
    const url = req.url || "/";

    try {
      if (!isProduction) {
        const handled = await new Promise(resolve => {
          vite.middlewares(req, res, () => resolve(false));
        });
        if (handled !== false) return;
        if (!req.headers.accept?.includes("text/html")) {
          if (!res.headersSent) {
            res.statusCode = 404;
            res.end();
          }
          return;
        }
      }

      if (isProduction && url !== "/") {
        const filePath = path.resolve(__dirname, "dist/client" + url);
        try {
          const content = readFileSync(filePath);
          res.setHeader("Content-Type", MIME[path.extname(url)] || "application/octet-stream");
          res.end(content);
          return;
        } catch {
          // Fall through to SSR
        }
      }

      let render;
      if (!isProduction) {
        ({ render } = await vite.ssrLoadModule("/entry-server.tsx"));
      } else {
        ({ render } = await import("./dist/server/entry-server.js"));
      }

      const stream = render(url);
      const clientEntry = isProduction ? getClientEntry() : null;

      res.setHeader("Content-Type", "text/html");
      res.write("<!DOCTYPE html>");
      stream.pipe({
        write(chunk) {
          let html = chunk;
          // Inject the Vite client for HMR in dev; point at the built client
          // entry in prod.
          if (!isProduction && html.includes("</head>")) {
            html = html.replace(
              "</head>",
              '<script type="module" src="/@vite/client"></script></head>'
            );
          }
          if (isProduction && html.includes("/client.tsx")) {
            html = html.replace("/client.tsx", clientEntry);
          }
          return res.write(html);
        },
        end() {
          res.end();
        }
      });
    } catch (e) {
      if (!isProduction) vite.ssrFixStacktrace(e);
      console.error(e);
      res.statusCode = 500;
      res.end(e.message);
    }
  });

  if (!isProduction) {
    const { createServer } = await import("vite");
    vite = await createServer({
      configFile: path.resolve(__dirname, "vite.config.mjs"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "custom"
    });
  }

  server.listen(port, () => {
    console.log(`Streaming SSR example listening on http://localhost:${port}`);
  });
}

start();
