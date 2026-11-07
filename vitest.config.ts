import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// docs/research holds complete upstream repos, their test suites included.
// They are read-only evidence, never part of this product's test set.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { exclude: [...configDefaults.exclude, 'docs/research/**'] },
  }),
)
