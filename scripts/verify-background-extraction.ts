/** Structural and behavioral guard for L4 background extraction. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAgentViewProjection } from '../src/dsh-adapter/channel/agent-view-projection.js'
import { createBackgroundCurrentAction } from '../src/dsh-adapter/channel/background-action.js'
import { createChannelBinding } from '../src/dsh-adapter/channel/binding.js'
import { createJobProjection } from '../src/dsh-adapter/channel/job-projection.js'
import { createChannelOwner } from '../src/dsh-adapter/channel/owner.js'
import { createSubagentProjection } from '../src/dsh-adapter/channel/subagent-projection.js'

const source = (path: string) => readFileSync(new URL(`../src/dsh-adapter/${path}`, import.meta.url), 'utf8')
const root = source('channel.ts')
const agentView = source('channel/agent-view-projection.ts')
const background = source('channel/background-action.ts')
const jobs = source('channel/job-projection.ts')
const subagents = source('channel/subagent-projection.ts')

for (const [label, text] of Object.entries({ agentView, background, jobs, subagents })) {
  assert.match(text, /^import /mu, `${label} remains a real focused module`)
}
assert.match(root, /createAgentViewProjection\(/u)
assert.match(root, /createBackgroundCurrentAction\(/u)
assert.match(root, /createJobProjection\(/u)
assert.match(root, /createSubagentProjection\(/u)
assert.doesNotMatch(root, /const agentViewFolds =/u, 'agent-view fold cache belongs to its module')
assert.doesNotMatch(root, /const jobRowsByJobId =/u, 'job row projection belongs to its module')
assert.doesNotMatch(root, /const subagentRowsByAgentId =/u, 'subagent row projection belongs to its module')
assert.doesNotMatch(root, /let subagentStreamDirty =/u, 'subagent stream batching belongs to its module')
assert.doesNotMatch(root, /async dispatchBackgroundAgent\(/u, 'background dispatch belongs to the agent-view module')
assert.doesNotMatch(root, /async backgroundCurrent\(/u, 'background handoff belongs to the background action module')
assert.match(agentView, /backgroundHandles/u)
assert.match(agentView, /deps\.owner\.current\(\)/u, 'post-await background work is owner-fenced')
assert.match(agentView, /await detached\.release\(\)/u, 'revoked detached handles are disposed')
assert.match(agentView, /bindApprovalStore/u, 'approval parked IDs stay a live agent-view dependency')
assert.match(background, /deps\.binding\.prepare/u)
assert.match(background, /deps\.binding\.adopt/u)
assert.match(background, /deps\.binding\.isCurrent\(adoption\)/u, 'rival switch rejects prepared handoff')
assert.match(jobs, /attachmentCurrent/u, 'jobs callbacks are token and owner guarded')
assert.match(jobs, /releaseOwner = deps\.owner\.own\(detach\)/u, 'every attachment is owned by the channel')
assert.match(jobs, /for \(const dispose of disposers\.splice\(0\)\)/u, 'a partial registration rolls its first subscription back')
assert.match(jobs, /release\?\.\(\)/u, 'a service detach releases its owner cleanup immediately')
assert.match(jobs, /markChannelReadDirty/u, 'job projection retains read-view dirty marks')
assert.match(subagents, /lookupChild/u, 'child discovery is a lazy optional callback')
assert.match(subagents, /streamDirty/u)
assert.match(subagents, /emitStream/u, 'stream deltas remain frame batched')
assert.match(subagents, /markChannelReadDirty/u, 'subagent rows retain read-view dirty marks')

const fakeAgent = (id = 'main') => ({
  id,
  status: 'idle',
  session: { id, events: [], header: { createdAt: 0 } },
  followup() {}, steer() {}, cancel() {}, inbox: { remove: () => true }, ctx: { on: () => () => undefined },
})

// Retained registry callbacks after replacement or mount disposal cannot list,
// notify, emit, or alter rows. The same attachment disposer is safely called
// by both the service lifetime and the Channel owner.
{
  const owner = createChannelOwner()
  const state = { backgroundJobs: [] as unknown[], rows: [] as unknown[], emits: 0, emit() { this.emits += 1 } }
  let firstLists = 0
  let secondLists = 0
  let firstListener: (() => void) | undefined
  let secondListener: (() => void) | undefined
  let firstUnsubscribes = 0
  let secondUnsubscribes = 0
  let serviceDispose: (() => void) | undefined
  const first = {
    list: () => { firstLists += 1; return [{ id: 'first', kind: 'bash', label: 'first', status: 'running' as const, startedAt: 1 }] },
    kill() {},
    onJobsChanged(listener: () => void) { firstListener = listener; return () => { firstUnsubscribes += 1 } },
  }
  const second = {
    list: () => { secondLists += 1; return [{ id: 'second', kind: 'bash', label: 'second', status: 'running' as const, startedAt: 2 }] },
    kill() {},
    onJobsChanged(listener: () => void) { secondListener = listener; return () => { secondUnsubscribes += 1 } },
  }
  const projection = createJobProjection(() => state as never, {
    owner,
    notify() {},
    rowIds: { value: 0 },
    agent: () => fakeAgent() as never,
    steer() {},
  })
  projection.attach(first as never)
  projection.attach(second as never, dispose => { serviceDispose = dispose })
  const firstCountAfterReplacement = firstLists
  firstListener?.()
  assert.equal(firstLists, firstCountAfterReplacement, 'retained replacement callback must not read old jobs service')
  const rowsBeforeDispose = state.rows.length
  const listsBeforeDispose = secondLists
  owner.dispose()
  secondListener?.()
  serviceDispose?.()
  assert.equal(secondLists, listsBeforeDispose, 'retained callback after owner disposal must not call list')
  assert.equal(state.rows.length, rowsBeforeDispose, 'retained callback after owner disposal must not alter rows')
  assert.equal(firstUnsubscribes, 1, 'replacement cleanup runs once')
  assert.equal(secondUnsubscribes, 1, 'dual owner/service cleanup remains idempotent')
}

// A synchronous eager callback followed by a throwing second registration
// must roll back the first listener and not retain an owner cleanup.
{
  const owner = createChannelOwner()
  let firstUnsubscribes = 0
  const projection = createJobProjection(() => ({ backgroundJobs: [], rows: [], emit() {} }) as never, {
    owner, notify() {}, rowIds: { value: 0 }, agent: () => fakeAgent() as never, steer() {},
  })
  const jobs = {
    list: () => [],
    onJobsChanged(listener: () => void) { listener(); return () => { firstUnsubscribes += 1 } },
    onJobDone() { throw new Error('second registration failed') },
  }
  assert.throws(() => projection.attach(jobs as never), /second registration failed/)
  assert.equal(firstUnsubscribes, 1, 'first eager subscription is rolled back when second registration throws')
  assert.equal(owner.cleanupCount, 0, 'failed attachment leaves no Channel owner cleanup')
}

// A discovery seam can fail at either Context lookup or agents.get without
// suppressing the authoritative spawned fact and synchronous publication.
for (const label of ['ctx lookup throws', 'agents.get throws']) {
  const owner = createChannelOwner()
  const state = { rows: [] as unknown[], subagents: [] as unknown[], emits: 0, emit() { this.emits += 1 }, emitStream() {} }
  const projection = createSubagentProjection(() => state as never, {
    rowIds: { value: 0 },
    agent: () => fakeAgent() as never,
    subagents: () => undefined,
    lookupChild: () => { throw new Error(label) },
  })
  projection.onStart({ id: `child-${label}`, provider: 'worker' })
  assert.equal(projection.store.snapshot().length, 1, `${label}: spawned fact remains tracked`)
  assert.equal(state.subagents.length, 1, `${label}: spawned fact is published`)
  assert.equal(state.rows.length, 1, `${label}: spawned card is projected`)
  owner.dispose()
}

// Resume fold: settlement notices in the durable parent log are the only
// proof of a background child's outcome — catalog alone leaves `unknown`.
// Folded outcomes use the notice's wall time, and the closing message text
// behind the divider becomes the row summary.
{
  const owner = createChannelOwner()
  const state = { rows: [] as unknown[], subagents: [] as unknown[], emits: 0, emit() { this.emits += 1 }, emitStream() {} }
  const projection = createSubagentProjection(() => state as never, {
    rowIds: { value: 0 },
    agent: () => fakeAgent() as never,
    subagents: () => undefined,
    lookupChild: () => undefined,
  })
  projection.bootstrapFromLog([
    { type: 'subagent/catalog', time: 1000, data: { childId: 'child-a', childCreatedAt: 900, mode: 'continuable', label: '审查重构质量' } },
    { type: 'tool/result', time: 1100, data: { message: { toolCallId: 'call_1', content: [{ type: 'text', text: 'started subagent child-a' }] } } },
    { type: 'agent/inbox/spliced', time: 9000, data: { target: 'next-step', inserted: [{ content: [
      { type: 'text', text: 'Background subagent child-a finished and will do no further work unless you send it more.' },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: '评估完成：7 / 10。' },
    ], source: { kind: 'subagent-settled', form: 'notice', summary: 'Background subagent child-a finished and will do no further work unless you send it more.', senderSessionId: 'child-a' } }] } },
    // A second child settles as stopped; a third fails; a catalog-only child
    // stays unknown (no proof either way).
    { type: 'subagent/catalog', time: 1200, data: { childId: 'child-b', childCreatedAt: 1150, label: '另一任务' } },
    { type: 'agent/inbox/spliced', time: 9500, data: { inserted: [{ content: [
      { type: 'text', text: 'Background subagent child-b was stopped before it finished.' },
    ], source: { kind: 'subagent-settled', senderSessionId: 'child-b', summary: 'Background subagent child-b was stopped before it finished.' } }] } },
    { type: 'subagent/catalog', time: 1300, data: { childId: 'child-c', childCreatedAt: 1250, label: '失败任务' } },
    { type: 'agent/inbox/spliced', time: 9800, data: { inserted: [{ content: [
      { type: 'text', text: 'Background subagent child-c failed before it finished.' },
    ], source: { kind: 'subagent-settled', senderSessionId: 'child-c', summary: 'Background subagent child-c failed before it finished.' } }] } },
    { type: 'subagent/catalog', time: 1400, data: { childId: 'child-d', childCreatedAt: 1350, label: '无终态任务' } },
    { type: 'agent/inbox/spliced', time: 9900, data: { inserted: [{ content: [
      { type: 'text', text: 'unrelated user message' },
    ], source: { kind: 'user' } }] } },
  ])
  const byId = new Map(projection.store.snapshot().map(s => [s.agentId, s]))
  assert.equal(byId.get('child-a')?.status, 'completed', 'settled fold: completed outcome replaces unknown')
  assert.equal(byId.get('child-a')?.completedAt, 9000, 'settled fold closes at the notice wall time')
  assert.equal(byId.get('child-a')?.summary, '评估完成：7 / 10。', 'closing message behind the divider becomes the summary')
  assert.equal(byId.get('child-b')?.status, 'cancelled', 'stopped settlement folds to cancelled')
  assert.equal(byId.get('child-c')?.status, 'failed', 'failed settlement folds to failed')
  assert.equal(byId.get('child-d')?.status, 'unknown', 'catalog-only child without a settlement stays unknown')
  owner.dispose()
}

// A target chosen before the async attach decision must remain that exact
// object. A registry replacement during the decision is cancelled rather
// than adopted as an arbitrary newer target.
{
  const owner = createChannelOwner()
  const main = fakeAgent('main')
  const first = fakeAgent('selected')
  const replacement = fakeAgent('selected')
  let current = first
  let releaseDecision!: () => void
  const decision = new Promise<void>(resolve => { releaseDecision = resolve })
  const enteredDecision = Promise.withResolvers<void>()
  let adopted = 0
  const projection = createAgentViewProjection({
    on: () => () => undefined,
    get(name: string) {
      return name === 'agents' ? { list: () => [], get: () => current, create: async () => ({}) } : undefined
    },
  } as never, {
    owner, binding: createChannelBinding(main as never, undefined, owner), cwd: () => '/tmp', provider: 'provider', model: 'model',
    notify() {}, listPersisted: async () => [], createDetached: async () => { throw new Error('unused') },
    sessionSwitchVetoed: async () => { enteredDecision.resolve(); await decision; return false },
    adoptLive: async () => { adopted += 1; return { ok: true } }, resumeInto: async () => ({ ok: true }),
  })
  const pending = projection.attach('selected')
  await enteredDecision.promise
  current = replacement
  releaseDecision()
  assert.deepEqual(await pending, { ok: false, reason: 'cancelled' })
  assert.equal(adopted, 0, 'replacement target is not adopted after the async decision')
  owner.dispose()
}

// A delayed /bg candidate revoked during create disposes exactly once and
// returns a failure result; guarded notification must not turn it into a
// rejected promise after the owner is dead.
{
  const owner = createChannelOwner()
  let resolveCreate!: (value: unknown) => void
  const pendingCreate = new Promise(resolve => { resolveCreate = resolve })
  let disposes = 0
  const candidate = { agent: fakeAgent('candidate'), async dispose() { disposes += 1 } }
  const capture = { agent: fakeAgent('origin') as never, generation: 1 }
  const action = createBackgroundCurrentAction({
    get(name: string) {
      if (name === 'agents') return { create: () => pendingCreate.then(() => candidate as never) }
      return undefined
    },
    logger: { warn() {} },
  } as never, {
    cwd: '/tmp', notify() { throw new Error('raw state.notify must not be called') },
  } as never, { provider: 'provider', model: 'model' }, {
    owner,
    binding: {
      capture: () => capture,
      isCurrent: () => owner.current(),
      async prepare(_capture, create) {
        const handle = await create()
        if (!owner.current()) { await handle.dispose(); throw new Error('dsh-tui: Channel lifetime has ended') }
        return handle
      },
      async abandon(handle) { await handle.dispose() },
      adopt() { throw new Error('must not adopt revoked candidate') },
    } as never,
    backgroundHandles: new Map(), rowIds: { value: 0 }, resetProjector() {}, resetSubagents() {}, resetJobs() {},
    refreshEffortLevels() {}, bindAgent() {}, refreshCommands() {}, async refreshLoadedContext() {}, async refreshSkillCommands() {},
    clearStagedImages() {}, notifySessionSwitched() {}, notify() {}, notifyAgentView() {},
  })
  const resultPromise = action()
  owner.dispose()
  resolveCreate(undefined)
  const result = await resultPromise
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'failed')
  assert.equal(disposes, 1, 'revoked prepared handle is disposed exactly once')
}

// Forgetting persisted metadata does not lose the live ledger entry: it can
// still be stopped, and an un-stopped forgotten handle remains owner-owned.
{
  const makeProjection = (owner = createChannelOwner()) => {
    const main = fakeAgent('main')
    const ctx = { on: () => () => undefined, get: () => ({ list: () => [], get: () => undefined, create: async () => ({}) }) }
    const projection = createAgentViewProjection(ctx as never, {
      owner, binding: createChannelBinding(main as never, undefined, owner), cwd: () => '/tmp', provider: 'provider', model: 'model',
      notify() {}, listPersisted: async () => [], createDetached: async () => { throw new Error('unused') },
      sessionSwitchVetoed: async () => false, adoptLive: async () => ({ ok: true }), resumeInto: async () => ({ ok: true }),
    })
    return { owner, projection }
  }
  const stopped = makeProjection()
  let stoppedDisposes = 0
  stopped.projection.backgroundHandles.set('forgotten', { agent: fakeAgent('forgotten'), async dispose() { stoppedDisposes += 1 } } as never)
  stopped.projection.forget('forgotten')
  assert.equal(await stopped.projection.stop('forgotten'), true)
  assert.equal(stoppedDisposes, 1, 'forgotten live handle remains stoppable')

  const cleaned = makeProjection()
  let ownerDisposes = 0
  cleaned.projection.backgroundHandles.set('forgotten-owner', { agent: fakeAgent('forgotten-owner'), async dispose() { ownerDisposes += 1 } } as never)
  cleaned.projection.forget('forgotten-owner')
  cleaned.owner.dispose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ownerDisposes, 1, 'forgotten live handle remains owner-cleaned')
}

console.log('verify:background-extraction OK')
