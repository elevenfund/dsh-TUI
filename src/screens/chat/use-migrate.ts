import React from 'react'
import { t } from '../../i18n.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { cleanRenderText } from '../../dsh-adapter/sanitize.js'
import { collectMigratePickerRows, parseImportSummary, type MigratePickerRow } from '../../dsh-adapter/migrate/picker.js'
import type { ChannelUi as Channel } from '../../adapter/channel/ui-policy.js'

const MIGRATE_CHILD_TIMEOUT_MS = 30 * 60 * 1000

/** The `/migrate` picker state and its child-process orchestration. The rows
 * are null while the background scan runs (the picker paints its empty state
 * until the sub-second scan lands); the multi-select, the confirmation
 * layer's frozen snapshot, and the smart-hint arming (a bare Enter while the
 * migration hint notification is up jumps straight into the picker with that
 * source pre-checked — any other key disarms) all live here too. */
export function useMigratePicker(channel: Channel): {
  migrateRows: MigratePickerRow[] | null
  setMigrateRows: React.Dispatch<React.SetStateAction<MigratePickerRow[] | null>>
  migrateChecked: ReadonlySet<string>
  setMigrateChecked: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  migratePending: readonly MigratePickerRow[]
  setMigratePending: React.Dispatch<React.SetStateAction<readonly MigratePickerRow[]>>
  migrateHintAgent: string | null
  setMigrateHintAgent: React.Dispatch<React.SetStateAction<string | null>>
  collectMigrateRows: () => Promise<MigratePickerRow[]>
  spawnMigrateSources: (rows: readonly MigratePickerRow[], dryRun: boolean) => void
} {
  const [migrateRows, setMigrateRows] = React.useState<MigratePickerRow[] | null>(null)
  const [migrateChecked, setMigrateChecked] = React.useState<ReadonlySet<string>>(new Set())
  const [migratePending, setMigratePending] = React.useState<readonly MigratePickerRow[]>([])
  const [migrateHintAgent, setMigrateHintAgent] = React.useState<string | null>(null)

  const collectMigrateRows = (): Promise<MigratePickerRow[]> => new Promise(resolve => {
    setImmediate(() => resolve(collectMigratePickerRows(Date.now())))
  })

  /** Run `dsh-tui migrate <args>` in a child process through the package
   *  bin; resolves with the exit code and the combined output. Uses the
   *  shared no-throw runner (bounded capture, timeout, windowsHide): a wedged
   *  child would otherwise hang the sequential per-source loop forever. */
  const runMigrateChild = async (parts: readonly string[]): Promise<{ code: number | null, out: string }> => {
    const { dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const { resolveOwnBin } = await import('../../dsh-adapter/migrate/bin-path.js')
    // This file sits at a different depth per layout (src/screens vs
    // lib/types/screens), so the bin resolves by upward probe — see
    // bin-path.ts; a fixed dirname count fails on real installs.
    const bin = resolveOwnBin(dirname(fileURLToPath(import.meta.url)))
    if (bin === undefined) {
      channel.notify(t('migrate-spawn-failed'), { color: 'error', timeoutMs: 8000 })
      return { code: -1, out: '' }
    }
    const result = await execFileNoThrow(process.execPath, [bin, 'migrate', ...parts], {
      timeout: MIGRATE_CHILD_TIMEOUT_MS,
    })
    // A killed child reports `code: null` and whatever it managed to print; put
    // the reason on the record so the transcript does not read as a silent
    // failure. Nothing at all (no code, no output) means it never really ran.
    if (result.code === null) {
      return {
        code: null,
        out: `${result.stdout}${result.stderr}${t('migrate-child-timeout', { minutes: MIGRATE_CHILD_TIMEOUT_MS / 60_000 })}\n`,
      }
    }
    if (result.code === 1 && result.stdout === '' && result.stderr === '') {
      channel.notify(t('migrate-spawn-failed'), { color: 'error', timeoutMs: 8000 })
    }
    // stdout carries the per-source report, stderr the usage/error lines;
    // both belong in the /migrate transcript row.
    return { code: result.code, out: `${result.stdout}${result.stderr}` }
  }

  /** Orchestrate the confirmation layer's confirmed rows (PRD #3): one child
   *  per source, sequential; per-source progress notifications (throttled by
   *  the source boundary — no intra-source spam), real per-source counters
   *  parsed from each child's report, and a final summary that NEVER claims
   *  success for a source that did not run (the P2 fix). */
  const spawnMigrateSources = (rows: readonly MigratePickerRow[], dryRun: boolean): void => {
    const allOut: string[] = []
    let failures = 0
    void (async () => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!
        channel.notify(
          t(dryRun ? 'migrate-previewing-source' : 'migrate-importing-source', { label: row.label, i: i + 1, n: rows.length }),
          { timeoutMs: 4000 },
        )
        const { code, out } = await runMigrateChild(dryRun ? [row.agentId, '--dry-run'] : [row.agentId])
        allOut.push(...out.split('\n').map(line => cleanRenderText(line, 400)).filter(Boolean))
        if (code !== 0) failures += 1
        // Per-source real counters straight from the child's report line.
        const summary = parseImportSummary(out).find(entry => entry.agentId === row.agentId)
        if (!dryRun && summary !== undefined) {
          channel.notify(
            t('migrate-source-done', { label: row.label, imported: summary.imported, existing: summary.existing }),
            { timeoutMs: 6000 },
          )
        }
      }
      // The transcript row is this run's record. When a source failed AND no
      // child output was captured at all (killed by the timeout, or never
      // spawned), the success wording would contradict the notification right
      // above it — report the failure here too.
      const fallbackLine = failures > 0
        ? t('migrate-failed', { n: failures })
        : t(dryRun ? 'migrate-all-previewed' : 'migrate-all-done', { n: rows.length })
      channel.pushLocal('/migrate', allOut.length > 0 ? allOut : [fallbackLine])
      channel.notify(
        failures === 0
          ? t(dryRun ? 'migrate-all-previewed' : 'migrate-all-done', { n: rows.length })
          : t('migrate-failed', { n: failures }),
        failures === 0 ? { timeoutMs: 6000 } : { color: 'error', timeoutMs: 10000 },
      )
    })()
  }

  return {
    migrateRows, setMigrateRows,
    migrateChecked, setMigrateChecked,
    migratePending, setMigratePending,
    migrateHintAgent, setMigrateHintAgent,
    collectMigrateRows, spawnMigrateSources,
  }
}
