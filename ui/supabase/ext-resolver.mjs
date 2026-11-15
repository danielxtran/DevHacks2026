// Node ESM loader hook: let extensionless relative imports (as used by the Vite
// app source, e.g. `import ... from './generators'`) resolve to their .js file.
// This lets the push script import the app's seed/constants modules unchanged.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const base = new URL(specifier, context.parentURL)
      for (const ext of ['.js', '.mjs', '.jsx']) {
        const candidate = new URL(base.href + ext)
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(specifier + ext, context)
        }
      }
    } catch {
      /* fall through to default */
    }
  }
  return nextResolve(specifier, context)
}
