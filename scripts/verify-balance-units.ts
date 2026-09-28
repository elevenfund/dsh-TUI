#!/usr/bin/env node
/**
 * Balance/cost unit regression (T0, mock network only).
 *
 * Split out of verify-balance.tsx Part A: fetchBalance response parsing
 * (multi-currency, string numerics, is_available) and failure
 * classification (401 / HTTP / network / invalid / empty key), baseUrl
 * joining and timeout; deepseekPricing table matching (longest prefix),
 * Beijing peak/idle windows, cache-hit pricing, unknown-model and
 * zero-token refusal, official-provider check. The /balance Chat
 * interaction (mount + SGR) stays in the original script.
 *
 * Run: node --import tsx/esm scripts/verify-balance-units.ts
 */
import { fetchBalance } from '../src/deepseekBalance.js'
import {
  estimateSessionCostCny,
  estimateSessionCostSplitCny,
  isDeepSeekOfficialProvider,
  isPeakHour,
  priceForModel,
} from '../src/deepseekPricing.js'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${detail === '' ? '' : `  (${detail})`}`)
  if (!condition) failures += 1
}

// --- fetchBalance：响应解析 ---

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '5.5', granted_balance: '0', topped_up_balance: '5.5' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  check('fetchBalance 成功解析多币种', result.ok, JSON.stringify(result))
  if (result.ok) {
    check('fetchBalance is_available=true', result.isAvailable === true)
    check('fetchBalance 币种数量', result.balances.length === 2)
    const cny = result.balances[0]
    check('fetchBalance 字符串数字转数值', cny?.total === 110 && cny?.granted === 10 && cny?.toppedUp === 100, JSON.stringify(cny))
    check('fetchBalance 币种名', cny?.currency === 'CNY')
  }
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response(JSON.stringify({
      is_available: false,
      balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }],
    }), { status: 200 }),
  })
  check('fetchBalance is_available=false', result.ok && !result.isAvailable, JSON.stringify(result))
}

// --- fetchBalance：失败分类 ---

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response('unauthorized', { status: 401 }),
  })
  check('fetchBalance 401 → unauthorized', !result.ok && result.reason === 'unauthorized' && result.status === 401, JSON.stringify(result))
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response('boom', { status: 500 }),
  })
  check('fetchBalance 500 → http', !result.ok && result.reason === 'http' && result.status === 500, JSON.stringify(result))
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => { throw new TypeError('ECONNREFUSED') },
  })
  check('fetchBalance 网络异常 → network', !result.ok && result.reason === 'network', JSON.stringify(result))
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response('<html>not json</html>', { status: 200 }),
  })
  check('fetchBalance 非 JSON → invalid', !result.ok && result.reason === 'invalid', JSON.stringify(result))
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response(JSON.stringify({ is_available: true }), { status: 200 }),
  })
  check('fetchBalance 缺 balance_infos → invalid', !result.ok && result.reason === 'invalid', JSON.stringify(result))
}

{
  const result = await fetchBalance('sk-test', {
    fetchImpl: async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: 'abc', granted_balance: '1', topped_up_balance: '2' }],
    }), { status: 200 }),
  })
  check('fetchBalance 非法数字 → invalid', !result.ok && result.reason === 'invalid', JSON.stringify(result))
}

{
  const result = await fetchBalance('', { fetchImpl: async () => new Response('{}', { status: 200 }) })
  check('fetchBalance 空 key → no-key（不发请求）', !result.ok && result.reason === 'no-key', JSON.stringify(result))
}

{
  let calledUrl = ''
  const result = await fetchBalance('sk-test', {
    baseUrl: 'https://mirror.example.com/',
    fetchImpl: async (url) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ is_available: true, balance_infos: [] }), { status: 200 })
    },
  })
  check('fetchBalance baseUrl 拼接去尾斜杠', result.ok && calledUrl === 'https://mirror.example.com/user/balance', calledUrl)
}

{
  // 永不 resolve 的 fetch + 50ms 超时 → network。fake fetch 与真实
  // fetch 一样尊重 AbortSignal：abort 时 reject（AbortError）。
  const result = await fetchBalance('sk-test', {
    timeoutMs: 50,
    fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    }),
  })
  check('fetchBalance 超时 → network', !result.ok && result.reason === 'network', JSON.stringify(result))
}

// --- deepseekPricing：时段判断（北京时间） ---

// 北京 = UTC+8：北京 2026-08-17（周一）10:00 = UTC 02:00
const mondayPeak = new Date('2026-08-17T02:00:00Z')
check('isPeakHour 周一北京 10:00 → 高峰', isPeakHour(mondayPeak))
check('isPeakHour 周一北京 13:00 → 空闲', !isPeakHour(new Date('2026-08-17T05:00:00Z')))
check('isPeakHour 周一北京 08:00 → 空闲', !isPeakHour(new Date('2026-08-17T00:00:00Z')))
check('isPeakHour 周一北京 15:00 → 高峰', isPeakHour(new Date('2026-08-17T07:00:00Z')))
check('isPeakHour 周五北京 17:59 → 高峰', isPeakHour(new Date('2026-08-21T09:59:00Z')))
check('isPeakHour 周五北京 18:00 → 空闲', !isPeakHour(new Date('2026-08-21T10:00:00Z')))
check('isPeakHour 周六北京 10:00 → 空闲', !isPeakHour(new Date('2026-08-22T02:00:00Z')))
check('isPeakHour 周六北京 15:00 → 空闲', !isPeakHour(new Date('2026-08-22T07:00:00Z')))
check('isPeakHour 周日北京 10:00 → 空闲', !isPeakHour(new Date('2026-08-23T02:00:00Z')))

// --- deepseekPricing：单价匹配 ---

{
  const flash = priceForModel('deepseek-v4-flash')
  check('priceForModel 精确匹配 flash', flash !== undefined && flash.output[1] === 9.0)
  const vision = priceForModel('deepseek-v4-flash-vision-exp')
  check('priceForModel 最长前缀匹配 vision（flash 价）', vision !== undefined && vision.output[1] === 9.0)
  check('priceForModel 未知模型', priceForModel('gpt-4o') === undefined)
}

// --- deepseekPricing：估算（高峰/空闲分桶） ---

/** 构造分桶 token 的快捷方式。 */
const buckets = (peak: Partial<import('../src/deepseekPricing.js').CostTokenTotals>, idle: Partial<import('../src/deepseekPricing.js').CostTokenTotals> = {}) => ({
  peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...peak },
  idle: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...idle },
})

{
  // 高峰桶 1M 输入（未命中）→ 3.0 元（flash 高峰未命中价）
  const cost = estimateSessionCostCny(buckets({ input: 1_000_000 }), 'deepseek-v4-flash')
  check('估算 高峰桶 1M 输入未命中 = 3.0', cost !== undefined && Math.abs(cost - 3.0) < 1e-9, `cost=${cost}`)
}
{
  // 空闲桶 1M 输入（未命中）→ 1.5 元（flash 空闲未命中价）
  const cost = estimateSessionCostCny(buckets({}, { input: 1_000_000 }), 'deepseek-v4-flash')
  check('估算 空闲桶 1M 输入未命中 = 1.5', cost !== undefined && Math.abs(cost - 1.5) < 1e-9, `cost=${cost}`)
}
{
  // 跨时段会话：高峰 0.2M + 空闲 0.8M 输入 → 0.2×3.0 + 0.8×1.5 = 1.8
  const cost = estimateSessionCostCny(buckets({ input: 200_000 }, { input: 800_000 }), 'deepseek-v4-flash')
  check('估算 跨时段分桶各按对应单价 = 1.8', cost !== undefined && Math.abs(cost - 1.8) < 1e-9, `cost=${cost}`)
}
{
  // 缓存命中计价：高峰桶 1M 输入其中 0.8M 命中 → 0.2×3.0 + 0.8×0.10 = 0.68
  const cost = estimateSessionCostCny(buckets({ input: 1_000_000, cacheRead: 800_000 }), 'deepseek-v4-flash')
  check('估算 缓存命中按命中价 = 0.68', cost !== undefined && Math.abs(cost - 0.68) < 1e-9, `cost=${cost}`)
}
{
  // 输出计价：空闲桶 0.5M 输出 → 0.5×4.5 = 2.25（vision 同 flash 价）
  const cost = estimateSessionCostCny(buckets({}, { output: 500_000 }), 'deepseek-v4-flash-vision-exp')
  check('估算 输出按输出价（vision 前缀）= 2.25', cost !== undefined && Math.abs(cost - 2.25) < 1e-9, `cost=${cost}`)
}
{
  // 拆分函数：高峰/空闲各自金额
  const split = estimateSessionCostSplitCny(buckets({ input: 1_000_000 }, { input: 1_000_000 }), 'deepseek-v4-flash')
  check('估算拆分 peak=3.0 idle=1.5 total=4.5', split !== undefined && Math.abs(split.peak - 3.0) < 1e-9 && Math.abs(split.idle - 1.5) < 1e-9 && Math.abs(split.total - 4.5) < 1e-9, `split=${JSON.stringify(split)}`)
}
{
  // 缓存写超 input 的异常值钳制（防御）
  const cost = estimateSessionCostCny(buckets({ input: 100, cacheRead: 10_000 }), 'deepseek-v4-flash')
  check('估算 cacheRead 超 input 时钳制', cost !== undefined && cost >= 0, `cost=${cost}`)
}
{
  const cost = estimateSessionCostCny(buckets({}, {}), 'deepseek-v4-flash')
  check('估算 零 token → undefined', cost === undefined, `cost=${cost}`)
}
{
  const cost = estimateSessionCostCny(buckets({ input: 1_000 }), 'gpt-4o')
  check('估算 未知模型 → undefined', cost === undefined, `cost=${cost}`)
}

// --- deepseekPricing：官方 provider 判定 ---

check('isDeepSeekOfficialProvider deepseek-official', isDeepSeekOfficialProvider('deepseek-official'))
check('isDeepSeekOfficialProvider deepseek', isDeepSeekOfficialProvider('deepseek'))
check('isDeepSeekOfficialProvider deepseek-vision', isDeepSeekOfficialProvider('deepseek-vision'))
check('isDeepSeekOfficialProvider kimi-coding 为 false', !isDeepSeekOfficialProvider('kimi-coding'))
check('isDeepSeekOfficialProvider 空串为 false', !isDeepSeekOfficialProvider(''))

if (failures > 0) {
  console.error(`\nbalance units: ${failures} failure(s)`)
  process.exit(1)
}
console.log('\nbalance units: all checks passed')
