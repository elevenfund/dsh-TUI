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
 *
 * 闭包构建与隔离执行器抽在 scripts/lib/affected-core.mjs，与
 * watch-affected.mjs（保存即跑受影响子集）共享。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  ROOT,
  SCRIPT_SUFFIXES,
  buildReverseIndex,
  runPool,
} from './lib/affected-core.mjs'

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
          stack.push(resolve(current, entry.name))
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
const { scripts, reverse } = buildReverseIndex()
const hits = []
for (const script of scripts) {
  for (const file of changed) {
    if (reverse.get(file)?.includes(script)) { hits.push(script); break }
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
const results = await runPool(hits, {
  jobs,
  onResult(done) {
    console.log('\n===== ' + done.name + ' =====')
    process.stdout.write(done.chunks.map(c => c.toString()).join(''))
  },
})

const failed = results.filter(r => r.status !== 0)
console.log('\n[verify-affected] 汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过（jobs=' + jobs + '）')
for (const r of results.sort((a, b) => a.seconds - b.seconds)) {
  console.log('  ' + (r.status === 0 ? '✓' : '✗') + ' ' + r.name + '  ' + r.seconds.toFixed(1) + 's')
}
if (failed.length > 0) {
  console.error('[verify-affected] ' + failed.map(f => f.name).join(', ') + ' 失败')
  process.exit(1)
}
