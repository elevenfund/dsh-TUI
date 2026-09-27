import type { ActivityPhase } from '../../dsh-adapter/activity-store.js'

/** grok-style working line: the plugin's thinking/waiting `line` carries its
 *  own elapsed decoration (` · total 3s` / ` · 总3s`) — the bare `phrase` is
 *  preferred and any trailing elapsed segment is stripped as the fallback,
 *  keeping the row one clean sentence (the thinking duration lands on the
 *  settled `◆ Thought for Xs` row instead). Tool/done lines keep their own
 *  timings, which describe the tool or the turn, not the wait. */
export function grokWorkingLine(
  activity: { phase: ActivityPhase; line: string; phrase?: string },
): string {
  if (activity.phase === 'tool' || activity.phase === 'done') return activity.line
  if (activity.phrase !== undefined && activity.phrase !== '') return activity.phrase
  return activity.line.replace(/ · (?:total \S+|总\S+)$/u, '')
}
