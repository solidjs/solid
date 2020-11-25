module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/*.ts", "web/src/**/*.ts", "!**/*.d.ts"],
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
