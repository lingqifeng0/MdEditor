import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { realpathSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  server: { fs: { allow: [resolve(__dirname, '../..'), realpathSync(resolve(__dirname, '../../node_modules'))] } },
  test: {
    environment: 'jsdom',
    include: ['test/unit/specs/**/*.spec.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      common: resolve(__dirname, 'src/common'),
      '@shared': resolve(__dirname, 'src/shared'),
      main_renderer: resolve(__dirname, 'src/main'),
      '@muyajs/core': resolve(__dirname, '../muya/src')
    },
    extensions: ['.mjs', '.ts', '.js', '.json']
  }
})
