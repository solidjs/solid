const fs = require("fs");
const path = require("path");
const entryPath = path.resolve(process.argv[2]);
if (!fs.existsSync(entryPath)) {
  throw new Error(`Entry file not found: ${entryPath}`);
}
const server = require(entryPath);

async function write() {
  const res = await server({ url: process.argv[4] });
  fs.mkdir(path.dirname(process.argv[3]), {recursive: true},  () =>
    fs.writeFile(process.argv[3], res, () => process.exit(0))
  );
}
write();
