export type BoardStatus = 'planned' | 'in-progress' | 'blocked' | 'needs-human' | 'needs-review' | 'done' | 'unknown'
export type BoardRow = { flight: string; id: string; title: string; tier: 'easy' | 'normal'; plan: string; commit: string; status: BoardStatus; reason: string }
export type Board = {
  name: string
  rows: BoardRow[]
  format: { project: string | null; plugin: string }
  error: string | null
  plans: Record<string, BoardPlan>
  checks: Record<string, { done: boolean; text: string }[]>
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
}
export type BoardRun = {
  id: string
  command: string | null
  startedAt: number
  tokens: { in: number; out: number; cache: number }
  gates: { runs: number; ms: number; red: number }
}
export type BoardRecord = BoardRun & { endedAt: number; ms: number; status: string }
export type BoardPhase = 'starting' | 'planning' | 'coding' | 'fixing' | 'review' | 'closing' | 'interrupted'
export type BoardLive = {
  command: 'pull' | 'shot' | 'brew' | null
  id: string | null
  phase: BoardPhase | null
  round: number
  since: number
  gate: { since: number; red: boolean } | null
  armed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    ristretto: {
      board: Board
      live: BoardLive | null
      elsewhere: boolean
      showDone: boolean
      tick: number
      open: string | null
      run: BoardRun | null
      runs: BoardRecord[]
    }
  }
}
