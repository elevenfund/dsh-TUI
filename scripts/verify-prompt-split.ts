#!/usr/bin/env node
/**
 * Sync pure-function tests for the prompt-input split (T0: constructing the
 * inputs is all there is — no FakeStdout, no sleeps, no renderer). Expected
 * values were probed from the live functions and hand-verified against the
 * whitespace-delimited word model, the Intl.Segmenter grapheme model, and
 * the stringWidth(2 for CJK) wrap model the composer renders with.
 */
import {
  vimLineEnd,
  vimLineFirstNonBlank,
  vimLineStart,
  vimWordBackward,
  vimWordEnd,
  vimWordForward,
  wordBoundaryLeft,
  wordBoundaryRight,
  graphemeBoundaries,
  nextGraphemeBoundary,
  normalizeCursorOffset,
  previousGraphemeBoundary,
  expandImageTokenRange,
  imageTokenSpans,
  snapOffImageToken,
} from '../src/components/prompt-input/text-motion.js'
import {
  caretInText,
  clickToCursorOffset,
  wrapToWidth,
} from '../src/components/prompt-input/wrap-geometry.js'

let failures = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`PASS: ${name}`)
  else { failures++; console.log(`FAIL: ${name}${detail ? `  (${detail})` : ''}`) }
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, actual === expected, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)

// ---- vim word motion: whitespace-delimited on mixed CJK/ASCII/punctuation ----
// A = "你好 world 测试 abc": 你好=0..2, ' '=2, world=3..8, ' '=8, 测试=9..11,
// ' '=11, abc=12..15. Words are whitespace runs of chars: 你好 | world | 测试 | abc.
const A = '你好 world 测试 abc'
eq('vimWordForward: word start → next word start', vimWordForward(A, 0), 3)
eq('vimWordForward: mid-ASCII-word → next word start', vimWordForward(A, 5), 9)
eq('vimWordForward: last word → text end', vimWordForward(A, 12), 15)
eq('vimWordBackward: mid-word → own word start', vimWordBackward(A, 5), 3)
eq('vimWordBackward: word start → previous word start', vimWordBackward(A, 3), 0)
eq('vimWordBackward: text end → last word start', vimWordBackward(A, 14), 12)
eq('vimWordEnd (dw target): first word → whitespace after it', vimWordEnd(A, 0), 2)
eq('vimWordEnd: mid-ASCII-word → whitespace after word', vimWordEnd(A, 5), 8)
eq('vimWordEnd: last word → text end', vimWordEnd(A, 12), 15)
eq('wordBoundaryLeft (alt+b): mid-word → word start', wordBoundaryLeft(A, 5), 3)
eq('wordBoundaryLeft: at word start → previous word start', wordBoundaryLeft(A, 14), 12)
eq('wordBoundaryRight (alt+f): word start → next word start', wordBoundaryRight(A, 0), 3)
eq('wordBoundaryRight: mid-word → next word start', wordBoundaryRight(A, 5), 9)
// Punctuation is NOT a break: with no whitespace, CJK+punct+ASCII is one word.
const P = '你好,world.测试'
eq('vimWordForward: punctuation run without spaces is one word', vimWordForward(P, 0), P.length)
eq('vimWordBackward: punctuation run without spaces is one word', vimWordBackward(P, P.length), 0)

// ---- line motion on multi-line text ----
// B = "one  two\n   indented line\n\nlast": rows at 0..7, 9..24, 26, 27..30.
const B = 'one  two\n   indented line\n\nlast'
eq('vimLineStart: first line offset 0', vimLineStart(B, 0), 0)
eq('vimLineStart: inside second line', vimLineStart(B, 13), 9)
eq('vimLineStart: on the blank line', vimLineStart(B, 26), 26)
eq('vimLineEnd: first line (exclusive, before \\n)', vimLineEnd(B, 0), 8)
eq('vimLineEnd: inside second line', vimLineEnd(B, 13), 25)
eq('vimLineEnd: blank line (start == end)', vimLineEnd(B, 26), 26)
eq('vimLineFirstNonBlank (^): line without indent', vimLineFirstNonBlank(B, 0), 0)
eq('vimLineFirstNonBlank: skips 3-space indent', vimLineFirstNonBlank(B, 10), 12)
eq('vimLineFirstNonBlank: blank line stays put', vimLineFirstNonBlank(B, 26), 26)

// ---- grapheme-cluster boundaries (ZWJ family emoji + CJK) ----
// C = "a👨‍👩‍👧b你": a=0, family emoji = code units 1..8 (one cluster), b=9, 你=10.
const C = 'a👨‍👩‍👧b你'
const boundsC = graphemeBoundaries(C)
check('graphemeBoundaries: family emoji is ONE cluster', JSON.stringify(boundsC) === JSON.stringify([0, 1, 9, 10, 11]), JSON.stringify(boundsC))
eq('previousGraphemeBoundary: inside surrogate pair snaps before emoji', previousGraphemeBoundary(boundsC, 2), 1)
eq('previousGraphemeBoundary: at emoji end → emoji start', previousGraphemeBoundary(boundsC, 9), 1)
eq('previousGraphemeBoundary: at CJK start → previous boundary', previousGraphemeBoundary(boundsC, 10), 9)
eq('nextGraphemeBoundary: inside surrogate pair snaps past emoji', nextGraphemeBoundary(boundsC, 2), 9)
eq('nextGraphemeBoundary: at emoji start → emoji end', nextGraphemeBoundary(boundsC, 1), 9)
eq('nextGraphemeBoundary: last boundary → text length', nextGraphemeBoundary(boundsC, 11), 11)
check('graphemeBoundaries: empty text yields [0]', JSON.stringify(graphemeBoundaries('')) === JSON.stringify([0]))

// ---- normalizeCursorOffset: clamp + snap onto clusters ----
eq('normalizeCursorOffset: mid-cluster snaps to cluster start', normalizeCursorOffset(C, 2), 1)
eq('normalizeCursorOffset: deep inside ZWJ sequence snaps to start', normalizeCursorOffset(C, 7), 1)
eq('normalizeCursorOffset: negative clamps to 0', normalizeCursorOffset(C, -3), 0)
eq('normalizeCursorOffset: past end clamps to length', normalizeCursorOffset(C, 99), 11)
eq('normalizeCursorOffset: already on a boundary is unchanged', normalizeCursorOffset(C, 9), 9)
eq('normalizeCursorOffset: empty text → 0', normalizeCursorOffset('', 0), 0)

// ---- image tokens: [Image #N] spans, snap-off, range expansion ----
// D = "看 [Image #1] 和 [Image #22]": [2,12) and [15,26).
const D = '看 [Image #1] 和 [Image #22]'
const spans = imageTokenSpans(D)
check('imageTokenSpans: both tokens with offsets (multi-digit #)', JSON.stringify(spans) === JSON.stringify([
  { start: 2, end: 12, token: '[Image #1]' },
  { start: 15, end: 26, token: '[Image #22]' },
]), JSON.stringify(spans))
eq('snapOffImageToken: interior near start → nearest edge start', snapOffImageToken(spans, 4, 'nearest'), 2)
eq('snapOffImageToken: interior near end → nearest edge end', snapOffImageToken(spans, 16, 'nearest'), 15)
eq('snapOffImageToken: prefer start', snapOffImageToken(spans, 8, 'start'), 2)
eq('snapOffImageToken: prefer end', snapOffImageToken(spans, 10, 'end'), 12)
eq('snapOffImageToken: outside any span unchanged', snapOffImageToken(spans, 13, 'nearest'), 13)
check('expandImageTokenRange: touching end swallows whole token', JSON.stringify(expandImageTokenRange(spans, 0, 3)) === JSON.stringify({ start: 0, end: 12 }), JSON.stringify(expandImageTokenRange(spans, 0, 3)))
check('expandImageTokenRange: start inside token, end outside', JSON.stringify(expandImageTokenRange(spans, 6, 14)) === JSON.stringify({ start: 2, end: 14 }), JSON.stringify(expandImageTokenRange(spans, 6, 14)))

// ---- wrap geometry: CJK width 2, newline handling, token spaces ----
check('wrapToWidth: CJK(2 cells) 3-per-6-col row, break at space',
  JSON.stringify(wrapToWidth('你好世界 abc def', 6)) === JSON.stringify(['你好世', '界 ', 'abc ', 'def']),
  JSON.stringify(wrapToWidth('你好世界 abc def', 6)))
check('wrapToWidth: newlines honoured, long word hard-wrapped',
  JSON.stringify(wrapToWidth('ab\ncdefg h', 3)) === JSON.stringify(['ab', 'cde', 'fg ', 'h']),
  JSON.stringify(wrapToWidth('ab\ncdefg h', 3)))
check('wrapToWidth: trailing space kept on the row it broke at',
  JSON.stringify(wrapToWidth('aaaa bbbb', 5)) === JSON.stringify(['aaaa ', 'bbbb']),
  JSON.stringify(wrapToWidth('aaaa bbbb', 5)))

// ---- caret ↔ click round trip on grapheme-boundary offsets ----
// T wraps at 8 cols into rows: 你好 | world | <emoji> | done.
const T = '你好 world 👨‍👩‍👧 done'
for (const off of [0, 2, 9, 18, 22]) {
  const p = caretInText(T, 8, off)
  eq(`round trip: caretInText(${off}) → clickToCursorOffset(line ${p.line}, col ${p.visualCol}) returns ${off}`,
    clickToCursorOffset(T, 8, p.line, p.visualCol), off)
}
const p6 = caretInText(T, 8, 6)
eq('round trip: offset inside the ASCII word returns itself', clickToCursorOffset(T, 8, p6.line, p6.visualCol), 6)
const pNL = caretInText('aaa\nbbbb', 10, 6)
check('round trip: second logical line', pNL.line === 1 && clickToCursorOffset('aaa\nbbbb', 10, pNL.line, pNL.visualCol) === 6, JSON.stringify(pNL))

// ---- caretInText / clickToCursorOffset direct geometry ----
const pEnd = caretInText('aaaa bbbb', 5, 5) // wrap join: caret at space end of row 0
check('caretInText: caret at a wrap join stays on the earlier row', pEnd.line === 0 && pEnd.charCol === 5, JSON.stringify(pEnd))
eq('clickToCursorOffset: half-width click on 2nd cell of CJK → after the glyph', clickToCursorOffset('你好世界', 4, 1, 1), 3)
eq('clickToCursorOffset: click past first CJK → after first glyph', clickToCursorOffset('你好世界', 4, 0, 3), 2)
eq('clickToCursorOffset: grapheme-start snap selects the glyph under the cell', clickToCursorOffset('你好世界', 4, 0, 2, 'grapheme-start'), 1)
eq('clickToCursorOffset: visual line past the end → one past the text (lineBase incl. \\n slot)', clickToCursorOffset('ab', 10, 5, 0), 3)

if (failures > 0) {
  console.error(`\nverify-prompt-split: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-prompt-split: all checks passed')
