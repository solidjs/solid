const fs = require("fs");
const glob = require("fast-glob");

const version = process.argv[2];

if (!version || version === "") {
  console.log("Please provide a version as the second argument");
  process.exit(1);
}

glob("packages/*/package.json").then(packages => {
  packages.forEach(packagePath => {
    const packageJson = JSON.parse(fs.readFileSync(packagePath));
    packageJson.version = version;
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
  });
});
