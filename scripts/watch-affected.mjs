#!/usr/bin/env node
/**
 * watch 模式：保存 src/ 下文件 → 防抖合并 → 自动跑受影响测试子集。
 *
 *   node scripts/watch-affected.mjs [--jobs N]
 *
 * 复用 verify-affected 的 import 闭包反查与隔离执行器
 * （scripts/lib/affected-core.mjs），输出形态对齐 run-ci-group：
 * 每脚本一行 ✓/✗ + 耗时，失败的脚本 dump 完整输出。
 * 批次执行期间到达的新变更会合并进下一批（串行批次，不并发重入）。
 * Ctrl+C 干净退出：关 watcher、收割在跑子进程、无残留。
 */
import { watch } from 'node:fs'
import { relative, resolve } from 'node:path'
import { buildReverseIndex, runPool } from './lib/affected-core.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = resolve(ROOT, 'src')
const DEBOUNCE_MS = 300
const SOURCE_RE = /\.(tsx|ts|mjs|js|jsx)$/

const jobsArg = process.argv.find(a => a.startsWith('--jobs'))
const jobs = Math.max(1, Math.min(16, Number(jobsArg?.split('=')[1] ?? jobsArg?.[2] ?? process.env.DSH_TUI_TEST_JOBS ?? '8') || 8))

const { scripts, reverse } = buildReverseIndex()
console.log('[watch] 反向索引就绪：' + scripts.length + ' 个脚本；监听 src/（jobs=' + jobs + '，Ctrl+C 退出）')

let pending = new Set()
let timer = null
let running = false
let closing = false
let pendingWhileRunning = new Set()
const liveChildren = new Set()

const stamp = () => new Date().toTimeString().slice(0, 8)

function schedule(abs) {
  if (closing) return
  pending.add(abs)
  if (timer) clearTimeout(timer)
  timer = setTimeout(fire, DEBOUNCE_MS)
}

async function fire() {
  if (running) { // merge into the next batch instead of overlapping pools
    for (const f of pending) pendingWhileRunning.add(f)
    pending = new Set()
    return
  }
  const files = [...pending]
  pending = new Set()
  running = true
  try {
    const hits = new Set()
    for (const file of files) for (const s of reverse.get(file) ?? []) hits.add(s)
    const names = files.map(f => relative(ROOT, f)).join(', ')
    if (hits.size === 0) {
      console.log('[watch ' + stamp() + '] ' + names + ' → 无测试命中（未被任何脚本 import）')
    } else {
      console.log('[watch ' + stamp() + '] ' + names + ' → ' + hits.size + ' 个脚本，开始执行…')
      const results = await runPool([...hits].sort(), {
        jobs,
        liveChildren,
        onResult(done) {
          console.log('  ' + (done.status === 0 ? '✓' : '✗') + ' ' + done.name + '  ' + done.seconds.toFixed(1) + 's')
          if (done.status !== 0) process.stdout.write(done.chunks.map(c => c.toString()).join(''))
        },
      })
      const failed = results.filter(r => r.status !== 0)
      console.log('[watch ' + stamp() + '] 批次汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过'
        + (failed.length ? '，失败：' + failed.map(f => f.name).join(', ') : ''))
    }
  } finally {
    running = false
    if (pendingWhileRunning.size > 0 && !closing) {
      for (const f of pendingWhileRunning) pending.add(f)
      pendingWhileRunning = new Set()
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, DEBOUNCE_MS)
    }
  }
}

const watcher = watch(SRC, { recursive: true }, (event, filename) => {
  if (!filename) return
  const abs = resolve(SRC, filename.toString())
  if (!SOURCE_RE.test(abs)) return
  schedule(abs)
})
watcher.on('error', error => {
  console.error('[watch] watcher 错误：' + error.message + '（退出）')
  process.exit(1)
})

process.on('SIGINT', () => {
  if (closing) return
  closing = true
  console.log('\n[watch] 收到 Ctrl+C，退出…')
  clearTimeout(timer)
  watcher.close()
  for (const child of liveChildren) {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
  // Give children a moment to die before exiting so no orphans remain.
  setTimeout(() => process.exit(0), 300).unref()
  process.exitCode = 0
})
