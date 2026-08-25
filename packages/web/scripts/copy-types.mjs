import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, ".types-build");

function rewritePublished(s, kind) {
  if (kind === "src") {
    return s
      .replaceAll("../server-functions/src/shared.js", "./server-functions/shared.js")
      .replaceAll("../server-functions/src/registry.js", "./server-functions/registry.js")
      .replaceAll("../serialization/src/serializer-decode.js", "./serializer-decode.js")
      .replaceAll("../serialization/src/serializer.js", "./serializer.js");
  }
  if (kind === "server-functions") {
    return s
      .replaceAll("../../serialization/src/serializer-decode.js", "../serializer-decode.js")
      .replaceAll("../../src/response.js", "../response.js")
      .replaceAll("../../src/server.js", "../server.js")
      .replaceAll("../../src/cookies.js", "../cookies.js");
  }
  if (kind === "frames") {
    return s
      .replaceAll("../../serialization/src/serializer-decode.js", "./serializer-decode.js")
      .replaceAll("../../serialization/src/serializer.js", "./serializer.js")
      .replaceAll("../../src/response.js", "../response.js")
      .replaceAll("../../src/server.js", "../server.js")
      .replaceAll("../../server-functions/src/shared.js", "../server-functions/shared.js")
      .replaceAll("../../server-functions/src/server.js", "../server-functions/server.js");
  }
  return s;
}

function copyDir(from, to, kind) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (!name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) continue;
    const src = fs.readFileSync(path.join(from, name), "utf8");
    fs.writeFileSync(path.join(to, name), rewritePublished(src, kind));
  }
}

copyDir(path.join(build, "src"), path.join(root, "types"), "src");

const clientPath = path.join(root, "types/client.d.ts");
const client = fs.readFileSync(clientPath, "utf8");
const marker = "export type { RequestEventLocals } from";
if (!client.includes(marker)) {
  throw new Error(
    "client.d.ts drift: the type-only RequestEventLocals re-export was not found — revisit the augmentation-identity rewrite"
  );
}
fs.writeFileSync(clientPath, client.replace(marker, "export { RequestEventLocals } from"));

fs.mkdirSync(path.join(root, "serialization/types"), { recursive: true });
const serializer = fs.readFileSync(path.join(build, "serialization/src/serializer.d.ts"));
const decode = fs.readFileSync(path.join(build, "serialization/src/serializer-decode.d.ts"));
fs.writeFileSync(path.join(root, "serialization/types/index.d.ts"), serializer);
fs.writeFileSync(path.join(root, "serialization/types/serializer.d.ts"), serializer);
fs.writeFileSync(path.join(root, "serialization/types/serializer-decode.d.ts"), decode);
fs.writeFileSync(path.join(root, "types/serializer.d.ts"), serializer);
fs.writeFileSync(path.join(root, "types/serializer-decode.d.ts"), decode);

copyDir(
  path.join(build, "server-functions/src"),
  path.join(root, "types/server-functions"),
  "server-functions"
);

copyDir(path.join(build, "frames/src"), path.join(root, "types/frames"), "frames");
fs.writeFileSync(path.join(root, "types/frames/serializer.d.ts"), serializer);
fs.writeFileSync(path.join(root, "types/frames/serializer-decode.d.ts"), decode);

fs.copyFileSync(path.join(root, "src/jsx.d.ts"), path.join(root, "types/jsx.d.ts"));
fs.copyFileSync(
  path.join(root, "src/jsx-properties.d.ts"),
  path.join(root, "types/jsx-properties.d.ts")
);
