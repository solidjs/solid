import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __DEV__: "false",
    __TEST__: "true"
  }
})