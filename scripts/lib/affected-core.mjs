/** Shared core for verify-affected.mjs and watch-affected.mjs:
 *  - import-closure reverse index (changed source file → hit verify/repro scripts)
 *  - parallel executor with per-script throwaway HOME and GROUPS extraEnv pins
 *  Parsing is conservative (regex imports + suffix/directory index attempts):
 *  an unresolved import only widens what we run (safe side), never narrows. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')
export const SCRIPT_SUFFIXES = ['.tsx', '.ts', '.mjs', '.js', '.jsx']

/** Resolve one import specifier relative to its importer, or null.
 *  Honors the TS ESM convention: a `.js`/`.jsx`/`.mjs` specifier may point
 *  at the sibling `.ts`/`.tsx` source, so the extension is stripped and
 *  re-tried too. */
function resolveFrom(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null // package import
  const bases = [resolve(dirname(fromFile), spec)]
  const m = /\.(js|jsx|mjs|cjs)$/.exec(bases[0])
  if (m) bases.push(bases[0].slice(0, -m[0].length))
  const candidates = []
  for (const base of bases) {
    for (const suffix of SCRIPT_SUFFIXES) candidates.push(base + suffix)
    for (const suffix of SCRIPT_SUFFIXES) candidates.push(join(base, 'index' + suffix))
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

const importCache = new Map()

/** Direct file dependencies of one file (parsed imports, resolved). */
function directDeps(file) {
  if (importCache.has(file)) return importCache.get(file)
  const deps = new Set()
  let text
  try { text = readFileSync(file, 'utf8') } catch { importCache.set(file, deps); return deps }
  const patterns = [
    /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*['"]([^'"]+)['"]/g,
    /export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const resolved = resolveFrom(file, m[1])
      if (resolved) deps.add(resolved)
    }
  }
  importCache.set(file, deps)
  return deps
}

/** Transitive import closure of a file (including itself). */
export function closure(file) {
  const seen = new Set()
  const stack = [file]
  while (stack.length > 0) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const dep of directDeps(current)) if (!seen.has(dep)) stack.push(dep)
  }
  return seen
}

/** Tool scripts that are never meaningful as a *subject* of an affected run
 *  (they need CLI arguments and would fail bare): excluded from the index. */
const SKIP_AS_SUBJECT = new Set(['verify-affected.mjs'])

/** All verify- and repro-prefixed scripts under scripts/. */
export function collectScripts() {
  const scripts = []
  for (const name of readdirSync(join(ROOT, 'scripts'))) {
    if (!/^(verify|repro)-/.test(name)) continue
    if (SKIP_AS_SUBJECT.has(name)) continue
    if (!SCRIPT_SUFFIXES.some(suffix => name.endsWith(suffix))) continue
    scripts.push(join(ROOT, 'scripts', name))
  }
  return scripts
}

/** Build once per process: every script's closure, plus a reverse map from
 *  each closed-over file to the scripts that (transitively) import it. */
export function buildReverseIndex() {
  const scripts = collectScripts()
  const reverse = new Map()
  for (const script of scripts) {
    for (const file of closure(script)) {
      let bucket = reverse.get(file)
      if (!bucket) reverse.set(file, bucket = [])
      bucket.push(script)
    }
  }
  return { scripts, reverse }
}

/** GROUPS extraEnv pins parsed out of run-ci-group.mjs so an affected/watch
 *  run sees the same environment as the cascade gate (colorize.ts clamps
 *  chalk under $TMUX; zh-contract suites need their DSH_TUI_LANG pin). */
export function groupExtras() {
  const src = readFileSync(join(ROOT, 'scripts/run-ci-group.mjs'), 'utf8')
  const map = new Map()
  for (const m of src.matchAll(/\[\s*['"]([\w.-]+)['"]\s*,\s*\[[^\]]*\]\s*,\s*\{\s*((?:[A-Za-z_]\w*\s*:\s*['"][^'"]*['"]\s*,?\s*)+)\}\s*\]/g)) {
    const env = {}
    for (const p of m[2].matchAll(/([A-Za-z_]\w*)\s*:\s*['"]([^'"]*)['"]/g)) env[p[1]] = p[2]
    map.set(m[1], env)
  }
  return map
}

const { TMUX: _hostTmux, ...childEnv } = { NODE_ENV: 'production', ...process.env }

/** Run one script in isolation (throwaway HOME, pinned env). Resolves to
 *  { name, status, chunks, seconds }. Registers the child on `liveChildren`
 *  so an abort handler can reap the batch on SIGINT. */
export function runOne(script, extras, liveChildren) {
  const suffix = script.endsWith('.mjs') ? [] : ['--import', 'tsx/esm']
  const argv = ['node', ...suffix, script]
  const scriptHome = mkdtempSync(join(tmpdir(), 'dsh-tui-affected-home-'))
  const extraEnv = extras.get(basename(script).replace(/\.[^.]+$/, '')) ?? {}
  const chunks = []
  const startedAt = performance.now()
  const promise = new Promise((resolveRun) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: ROOT,
      env: { ...childEnv, HOME: scriptHome, USERPROFILE: scriptHome, ...extraEnv },
      shell: false,
    })
    liveChildren?.add(child)
    const finish = code => { liveChildren?.delete(child); resolveRun(code) }
    child.stdout.on('data', d => chunks.push(d))
    child.stderr.on('data', d => chunks.push(d))
    child.on('error', (error) => { chunks.push(String(error)); finish(1) })
    child.on('close', code => finish(code ?? 1))
  })
  return promise.then(status => {
    rmSync(scriptHome, { recursive: true, force: true })
    return { name: relative(ROOT, script), status, chunks, seconds: (performance.now() - startedAt) / 1000 }
  })
}

/** Parallel worker pool over `scripts` (same isolation as run-ci-group).
 *  onResult fires as each script finishes (streaming progress); returns all
 *  results when the pool drains. Pass a `liveChildren` Set to keep a handle
 *  on in-flight children (watch mode reaps them on SIGINT). */
export async function runPool(scripts, { jobs = 8, onResult, liveChildren = new Set() } = {}) {
  const extras = groupExtras()
  const queue = [...scripts]
  const results = []
  const worker = async () => {
    while (queue.length > 0) {
      const script = queue.shift()
      const done = await runOne(script, extras, liveChildren)
      results.push(done)
      onResult?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, scripts.length)) }, worker))
  return results
}
