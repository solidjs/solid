module.exports = {
  collectCoverageFrom: [
    'src/**/{!(runtime),}'
  ],
  "resolver": "jest-ts-webcompat-resolver",
  "transformIgnorePatterns": [
    "node_modules/?!(dom-expressions)"
  ]
}