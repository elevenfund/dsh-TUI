#!/usr/bin/env node
/**
 * Hover-coalesce unit regression (T0, synchronous).
 *
 * Split out of verify-hover-coalesce.tsx: the no-interest-rect fast
 * path, cache safety across container subtrees / overlapping siblings /
 * multiple Ink roots, the frame-boundary invalidation hook, and the
 * hover interest probe — asserted by dispatching hover over synthetic
 * inert DOM trees (nodeCache geometry, no render). The SGR-driven Ink
 * pipeline scenarios stay in the original script.
 *
 * Run: node --import tsx/esm scripts/verify-hover-coalesce-units.ts
 */
import { createNode } from '../src/ink/dom.js'
import { nodeCache } from '../src/ink/node-cache.js'
import {
  dispatchHover,
  invalidateNoInterestRect,
  setHoverInterestProbe,
  getHitTestWithOverlaysCount,
  resetHitTestWithOverlaysCount,
} from '../src/ink/hit-test.js'

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  const mark = ok ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// ── 单元层：合成 DOM 树 + 直调 dispatchHover ──────────────────────
function makeInertTree() {
  const root = createNode('ink-root')
  const pad = createNode('ink-box')
  const text = createNode('ink-text')
  root.childNodes.push(pad)
  pad.parentNode = root
  pad.childNodes.push(text)
  text.parentNode = pad
  nodeCache.set(root, { x: 0, y: 0, width: 40, height: 12 })
  nodeCache.set(pad, { x: 2, y: 2, width: 20, height: 3 })
  nodeCache.set(text, { x: 2, y: 2, width: 20, height: 1 })
  return { root, pad, text }
}

{
  // U1: 无兴趣 rect 快路径——首次命中缓存、rect 内跳过、离开立即重测
  const { root } = makeInertTree()
  const hovered = new Set<import('../src/ink/dom.js').DOMElement>()
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  dispatchHover(root, 4, 2, hovered)
  const c1 = getHitTestWithOverlaysCount()
  check('U1 首次 motion 完整 hit-test 并缓存 rect', c1 === 1, `count=${c1}`)
  dispatchHover(root, 6, 2, hovered)
  check('U1 rect 内 motion 跳过 hit-test', getHitTestWithOverlaysCount() === 1,
    `count=${getHitTestWithOverlaysCount()}`)
  dispatchHover(root, 10, 2, hovered)
  check('U1 rect 内再 motion 仍跳过', getHitTestWithOverlaysCount() === 1)
  dispatchHover(root, 30, 10, hovered)
  check('U1 离开 rect 立即重新 hit-test', getHitTestWithOverlaysCount() === 2,
    `count=${getHitTestWithOverlaysCount()}`)
}

{
  // U2: hit 链 inert 但子树含 handler —— 不缓存，descendant enter 正常
  const root = createNode('ink-root')
  const outer = createNode('ink-box')
  const gap = createNode('ink-text')
  const inner = createNode('ink-box')
  root.childNodes.push(outer)
  outer.parentNode = root
  outer.childNodes.push(gap, inner)
  gap.parentNode = outer
  inner.parentNode = outer
  nodeCache.set(root, { x: 0, y: 0, width: 40, height: 12 })
  nodeCache.set(outer, { x: 2, y: 2, width: 30, height: 6 })
  nodeCache.set(gap, { x: 2, y: 2, width: 10, height: 1 })
  nodeCache.set(inner, { x: 20, y: 4, width: 8, height: 2 })
  const enters: string[] = []
  inner._eventHandlers = {
    onMouseEnter: () => enters.push('inner'),
    onMouseLeave: () => {},
  }
  const hovered = new Set<import('../src/ink/dom.js').DOMElement>()
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  // (4,5)：outer 内、gap/inner 外 → hit=outer，链 inert
  dispatchHover(root, 4, 5, hovered)
  check('U2 前置：hit 链确为 inert', getHitTestWithOverlaysCount() === 1)
  // (22,5) 落在 inner（有 handler）上：若误缓存 outer 的 rect 会被跳过
  dispatchHover(root, 22, 5, hovered)
  check('U2 子树含 handler 不缓存：descendant 仍被 hit-test',
    getHitTestWithOverlaysCount() === 2)
  check('U2 inner enter 正常触发', enters.length === 1 && enters[0] === 'inner',
    enters.join(','))
}

{
  // U2b: overlapping sibling with hover interest can become topmost inside
  // only part of an inert leaf rect; the cache must not hide its enter.
  const root = createNode('ink-root')
  const inert = createNode('ink-box')
  const floating = createNode('ink-box')
  root.childNodes.push(inert, floating)
  inert.parentNode = root
  floating.parentNode = root
  nodeCache.set(root, { x: 0, y: 0, width: 40, height: 12 })
  nodeCache.set(inert, { x: 2, y: 2, width: 20, height: 2 })
  nodeCache.set(floating, { x: 12, y: 2, width: 8, height: 2 })
  let entered = 0
  floating._eventHandlers = { onMouseEnter: () => { entered++ } }
  const hovered = new Set<import('../src/ink/dom.js').DOMElement>()
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  dispatchHover(root, 4, 2, hovered)
  dispatchHover(root, 14, 2, hovered)
  check('U2b 重叠 sibling 不被 inert rect 快路遮蔽',
    entered === 1 && getHitTestWithOverlaysCount() === 2,
    `enter=${entered} count=${getHitTestWithOverlaysCount()}`)
}

{
  // U2c: cache geometry is per root; one Ink tree must not skip another.
  const first = makeInertTree()
  const second = makeInertTree()
  let entered = 0
  second.pad._eventHandlers = { onMouseEnter: () => { entered++ } }
  const hoveredA = new Set<import('../src/ink/dom.js').DOMElement>()
  const hoveredB = new Set<import('../src/ink/dom.js').DOMElement>()
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  dispatchHover(first.root, 4, 3, hoveredA)
  dispatchHover(second.root, 4, 3, hoveredB)
  check('U2c no-interest cache 不跨 Ink root 串用',
    entered === 1 && getHitTestWithOverlaysCount() === 2,
    `enter=${entered} count=${getHitTestWithOverlaysCount()}`)
}

{
  // U3: 帧边界失效钩子——invalidate 后 rect 内 motion 重新 hit-test
  const { root } = makeInertTree()
  const hovered = new Set<import('../src/ink/dom.js').DOMElement>()
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  dispatchHover(root, 4, 3, hovered)
  invalidateNoInterestRect()
  dispatchHover(root, 6, 3, hovered)
  check('U3 失效后 rect 内 motion 重新 hit-test', getHitTestWithOverlaysCount() === 2)
}

{
  // U4: hover interest probe（tooltip 预留口）——兴趣节点不缓存
  const { root, pad } = makeInertTree()
  const hovered = new Set<import('../src/ink/dom.js').DOMElement>()
  setHoverInterestProbe((node) => node === pad)
  invalidateNoInterestRect()
  resetHitTestWithOverlaysCount()
  dispatchHover(root, 4, 3, hovered)
  const c1 = getHitTestWithOverlaysCount()
  dispatchHover(root, 6, 3, hovered)
  check('U4 probe 兴趣节点不缓存（rect 内仍 hit-test）',
    c1 === 1 && getHitTestWithOverlaysCount() === 2)
  setHoverInterestProbe(null)
}

if (failures > 0) {
  console.error(`\nhover-coalesce units: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nhover-coalesce units: all checks passed')
