module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**"],
  resolver: "jest-ts-webcompat-resolver",
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
