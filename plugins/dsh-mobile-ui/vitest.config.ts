/**
 * Standalone vitest config for the plugin: without it, a run from inside a
 * deepseek-harness checkout walks up to the repository's root config, whose
 * include patterns do not cover this package. Environment stays per-file
 * (the // @vitest-environment jsdom pragma), matching upstream convention.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
  },
})
