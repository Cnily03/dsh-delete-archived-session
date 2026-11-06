import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
  },
  format: ['esm'],
  target: 'esnext',
  outDir: 'dist',
  clean: true,
  // The client resolves react and the shipped UI primitives through the module
  // loader's injected `require` at runtime, so they must never be bundled.
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  // Readable output; the Host reads these files directly, not through a minifier.
  minify: false,
  dts: false,
  splitting: false,
  sourcemap: false,
  treeshake: true,
})
