export type BoardStatus = 'planned' | 'in-progress' | 'blocked' | 'done' | 'unknown'
export type BoardRow = { flight: string; id: string; title: string; tier: 'easy' | 'normal'; plan: string; commit: string; status: BoardStatus; reason: string }
export type Board = {
  name: string
  rows: BoardRow[]
  format: { project: string | null; plugin: string }
  error: string | null
  plans: Record<string, BoardPlan>
  checks: Record<string, { done: boolean; text: string; how: string }[]>
  decisions: Record<string, { taken: boolean; text: string }[]>
}
export type BoardPlan = {
  acceptance: { auto: boolean; text: string }[]
  depends: string[]
  blockers: string[]
  evidence: { criteria: number[]; proof: string }[]
  review: string | null
  gate: string | null
  findings: string[]
  itemised: boolean | null
  goal: string | null
}
export type BoardRun = {
  id: string
  command: string | null
  startedAt: number
  tokens: { in: number; out: number; cache: number }
  gates: { runs: number; ms: number; red: number }
  phases?: { plan: number; code: number; review: number; close: number }
  at?: { bucket: string; since: number } | null
}
export type BoardRecord = BoardRun & { endedAt: number; ms: number; status: string; runs?: number }
export type BoardPhase = 'starting' | 'planning' | 'coding' | 'fixing' | 'review' | 'closing' | 'interrupted'
export type BoardLive = {
  command: 'pull' | 'shot' | 'brew' | null
  id: string | null
  phase: BoardPhase | null
  round: number
  since: number
  gate: { since: number; red: boolean } | null
  armed: boolean
  unattended?: boolean
}
export type BoardPage = { kind: 'feature'; id: string; folder?: string | null } | { kind: 'history' } | { kind: 'queue' }
export type BoardFact = { file: string; title: string; text: string; source: string; state: 'confirmed' | 'unconfirmed'; by: string; older?: boolean; conflict: { what: string; source: string; by: string } | null }
export type BoardDomain = { tree: BoardFact[] }
export type BoardFile = { path: string; add: number; del: number; bin: boolean }
// The branch the session is on (board-branch.mjs): `ids` null when nothing can be scoped to it.
export type BoardBranch = { name: string; base: string | null; ids: string[] | null; lastBrew: string; onDefault?: boolean }
// The full-suite verdict as the Branch card reads it: green or red only while it proves the code there.
export type BoardSuite = { state: 'green' | 'red' | 'unproven'; text: string; failing: string }
// The run a pulling session leaves in its repo's .ristretto/at-work.json (board-atwork.mjs).
export type BoardAtWork = { v: 1; session: string; id: string; command: string | null; unattended: boolean; title: string; startedAt: number; phase: string | null; step: string; red: boolean; effort: { name: string; state: string; progress?: number }[]; beat: number; endedAt: number | null }
// One repo the board shows (board-timeline.mjs): `folder` null for the session's own repo.
export type BoardRepo = {
  folder: string | null
  board: Board
  branch: BoardBranch | null
  suite: BoardSuite | null
  runs: BoardRecord[]
  atWork: { state: 'running' | 'stopped' | 'ended' | 'none'; rec: BoardAtWork | null }
  age: string | null
}
export type BoardRole = { role: string; model: string; startedAt: number; endedAt: number | null }
// The run in progress, as the drawing needs it: which feature, since when.
export type BoardStarted = { id: string; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    ristretto: {
      repos: BoardRepo[]
      siblings: Record<string, Record<string, BoardStatus>>
      ownRec: BoardAtWork | null
      live: BoardLive | null
      page: BoardPage | null
      run: BoardRun | null
      runs: BoardRecord[]
      files: Record<string, BoardFile[]>
      folders: Record<string, Record<string, boolean>>
      paneOpen: boolean
      roles: Record<string, BoardRole[]>
      started: BoardStarted | null
      drawnAt: number
    }
  }
}
