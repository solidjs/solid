module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/*.ts", "web/src/**/*.ts", "!**/*.d.ts"],
  resolver: "jest-ts-webcompat-resolver",
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
