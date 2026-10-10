/**
 * Build `lib/client.js` from `src/client/main.js`.
 *
 * The output is a single, self-contained browser bundle in DSH module-table form:
 *
 *   window.__ModuleLoader__.load({ id, factory(require) { … return module.exports } })
 *
 * Three things this script guarantees, each of which has already caused a real
 * failure when done by hand:
 *
 *   1. **The loader wrapper is present.** Without it `require` is undefined at
 *      import time and the *whole web boot* fails, not just this plugin.
 *   2. **The bundle requires nothing of its own.** The browser has no relative
 *      resolution, so the pure logic is inlined instead of `require`d.
 *   3. **The output is never edited by hand.** `--check` mode rewrites the bundle
 *      from source and fails if the committed file differs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = `${ROOT}src/client/main.js`
const LOGIC = `${ROOT}lib/logic.js`
const OUT = `${ROOT}lib/client.js`
const PACKAGE_ID = 'dsh-rheostat-effort'

/** The pure-logic module, minus its CommonJS export footer. */
function inlineLogic() {
  const source = readFileSync(LOGIC, 'utf8')
  const start = source.indexOf('const MIN_LEVEL')
  const end = source.lastIndexOf('module.exports')
  if (start < 0 || end < 0) throw new Error('lib/logic.js no longer has the expected shape')

  // No indentation here: the body pass aligns the whole module in one go, so the
  // inlined logic keeps exactly the shape it has in lib/logic.js.
  return source.slice(start, end).trimEnd()
}

function wrap(body) {
  return `/**
 * dsh-rheostat-effort — generated browser bundle. DO NOT EDIT.
 * Source: src/client/main.js + lib/logic.js
 * Rebuild: node scripts/build-client.mjs
 *
 * The loader wrapper is mandatory: \`require\` is the loader's resolver and only
 * exists as the factory argument. A bare module calling \`require(...)\` throws
 * ReferenceError at import time, which fails the whole web boot.
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

${body}

    return module.exports
  },
})
`
}

const body = readFileSync(MAIN, 'utf8')
  .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
  .replace("'use strict'\n", '')
  // A function replacement, so `$&` or `$1` inside the inlined logic can never
  // be interpreted as a replacement pattern.
  .replace('/* __LOGIC__ */', () => inlineLogic())
  .trimEnd()
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : `    ${line}`))
  .join('\n')

const bundle = wrap(body)
const check = process.argv.includes('--check')
const existing = (() => {
  try {
    return readFileSync(OUT, 'utf8')
  } catch {
    return null
  }
})()

if (check) {
  if (existing !== bundle) {
    console.error('lib/client.js is out of date with src/client/main.js — run: node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log(`lib/client.js is up to date (${bundle.length} bytes)`)
} else {
  writeFileSync(OUT, bundle)
  console.log(`wrote lib/client.js (${bundle.length} bytes) from src/client/main.js`)
}
