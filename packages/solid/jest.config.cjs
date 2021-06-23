module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/*.ts", "store/src/**/*.ts", "web/src/**/*.ts", "!**/*.d.ts", "!src/server/*.ts", "!store/src/**/server.ts"],
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
