module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/*.ts", "web/src/**/*.ts", "!**/*.d.ts", "!src/static/*.ts"],
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
