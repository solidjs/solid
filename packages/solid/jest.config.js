module.exports = {
  verbose: false,
  collectCoverageFrom: ["src/**/{!(runtime|utils|reconcile)}"],
  resolver: "jest-ts-webcompat-resolver",
  transformIgnorePatterns: ["node_modules/?!(dom-expressions)"]
};
