import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { RollupLog } from 'rollup';

/**
 * Zod 4 carries `@__PURE__` annotations in positions Rollup will not attach to
 * a call, so every build printed six identical complaints about a dependency's
 * comments. Rollup drops the annotation and carries on; there is nothing to
 * fix here and nothing to learn from seeing it again. Only that one warning,
 * only from zod — anything else still has to be read.
 */
const quietZodAnnotations = (
  warning: RollupLog,
  handler: (warning: RollupLog) => void,
): void => {
  if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules/zod')) return;
  handler(warning);
};

export default defineConfig({
  main: {
    // better-sqlite3 is a native module: it must stay external, never bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        onwarn: quietZodAnnotations,
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        onwarn: quietZodAnnotations,
        // A sandboxed preload must be CommonJS; .cjs keeps Node from reading it
        // as ESM because package.json sets "type": "module".
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
        onwarn: quietZodAnnotations,
      },
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
});
