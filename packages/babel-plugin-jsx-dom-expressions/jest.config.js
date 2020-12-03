module.exports = {
  "moduleDirectories": ["node_modules", "packages"],
  "collectCoverageFrom": [
    "./index.js"
  ],
  "transform": {
    "^.+\\.jsx?$": "babel-jest"
  }
}