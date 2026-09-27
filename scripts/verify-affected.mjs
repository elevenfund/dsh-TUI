#!/usr/bin/env node
/**
 * affected-test 反查：静态 import 闭包建 src→scripts 依赖图，改哪跑哪。
 *
 *   node scripts/verify-affected.mjs src/screens/Chat.tsx
 *   node scripts/verify-affected.mjs src/screens/chat/ src/utils/narration.ts
 *
 * 从入口文件（脚本 + 其 import 的 src 闭包）出发反向找：哪个 verify/repro
 * 脚本的 import 闭包包含改动的文件。命中子集用 run-ci-group 的同款执行
 * 器并行跑（--jobs 默认 8；脚本进程隔离 + 一次性 HOME，天然可并行）。
 * 解析是保守的（正则 import + 后缀/目录 index 尝试）：漏解析只会多跑
 * （安全侧），不会漏跑。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

const SCRIPT_SUFFIXES = ['.tsx', '.ts', '.mjs', '.js', '.jsx']

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
function closure(file) {
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

// ---- collect all verify/repro scripts + lib under scripts/ ----
const scripts = []
for (const name of readdirSync(ROOT + '/scripts')) {
  if (!/^(verify|repro)-/.test(name)) continue
  if (!SCRIPT_SUFFIXES.some(suffix => name.endsWith(suffix))) continue
  scripts.push(join(ROOT, 'scripts', name))
}

// ---- expand the requested paths into concrete files ----
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('用法: node scripts/verify-affected.mjs <改动的文件或目录>...')
  process.exit(2)
}
const changed = new Set()
for (const arg of args) {
  const abs = resolve(process.cwd(), arg)
  if (existsSync(abs)) {
    // file or directory: walk one level of known source trees
    const stack = [abs]
    while (stack.length > 0) {
      const current = stack.pop()
      let isDir = false
      try { isDir = statSync(current).isDirectory() } catch { continue }
      if (isDir) {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          stack.push(join(current, entry.name))
        }
        continue
      }
      if (SCRIPT_SUFFIXES.some(suffix => current.endsWith(suffix))) changed.add(current)
    }
  } else {
    // maybe an extensionless path (git-style) — try suffixes
    for (const suffix of SCRIPT_SUFFIXES) if (existsSync(abs + suffix)) { changed.add(abs + suffix); break }
  }
}
if (changed.size === 0) {
  console.error('[verify-affected] 未找到源文件: ' + args.join(' '))
  process.exit(2)
}

// ---- reverse lookup: scripts whose closure touches a changed file ----
const hits = []
for (const script of scripts) {
  const depClosure = closure(script)
  for (const file of changed) {
    if (depClosure.has(file)) { hits.push(script); break }
  }
}
hits.sort()

console.log('[verify-affected] 改动 ' + changed.size + ' 个文件，命中 ' + hits.length + '/' + scripts.length + ' 个脚本：')
for (const hit of hits) console.log('  ' + relative(ROOT, hit))
if (hits.length === 0) {
  console.log('[verify-affected] 无命中——改动未被任何 verify/repro 脚本 import，跑全套前先确认是否有覆盖缺口')
  process.exit(0)
}

// ---- run the hit set through a parallel pool (same isolation as run-ci-group) ----
const jobs = Math.max(1, Math.min(16, Number(process.env.DSH_TUI_TEST_JOBS ?? '8') || 8))
const env = { NODE_ENV: 'production', ...process.env }
const results = []
const queue = [...hits]
const runOne = async (script) => {
  const suffix = script.endsWith('.mjs') ? [] : ['--import', 'tsx/esm']
  const argv = ['node', ...suffix, script]
  const scriptHome = mkdtempSync(join(tmpdir(), 'dsh-tui-affected-home-'))
  const chunks = []
  const startedAt = performance.now()
  const status = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: ROOT,
      env: { ...env, HOME: scriptHome, USERPROFILE: scriptHome },
      shell: false,
    })
    child.stdout.on('data', d => chunks.push(d))
    child.stderr.on('data', d => chunks.push(d))
    child.on('error', (error) => { chunks.push(String(error)); resolve(1) })
    child.on('close', code => resolve(code ?? 1))
  })
  rmSync(scriptHome, { recursive: true, force: true })
  return { name: relative(ROOT, script), status, chunks, seconds: (performance.now() - startedAt) / 1000 }
}
const worker = async () => {
  while (queue.length > 0) {
    const script = queue.shift()
    const done = await runOne(script)
    console.log('\n===== ' + done.name + ' =====')
    process.stdout.write(done.chunks.map(c => c.toString()).join(''))
    results.push(done)
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, hits.length) }, worker))

const failed = results.filter(r => r.status !== 0)
console.log('\n[verify-affected] 汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过（jobs=' + jobs + '）')
for (const r of results.sort((a, b) => a.seconds - b.seconds)) {
  console.log('  ' + (r.status === 0 ? '✓' : '✗') + ' ' + r.name + '  ' + r.seconds.toFixed(1) + 's')
}
if (failed.length > 0) {
  console.error('[verify-affected] ' + failed.map(f => f.name).join(', ') + ' 失败')
  process.exit(1)
}
