export type BoardStatus = 'planned' | 'in-progress' | 'blocked' | 'needs-human' | 'needs-review' | 'done' | 'unknown'
export type BoardRow = { flight: string; id: string; title: string; tier: 'easy' | 'normal'; plan: string; status: BoardStatus; reason: string }
export type Board = { name: string; rows: BoardRow[]; format: { project: string | null; plugin: string }; error: string | null }
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
    ristretto: { board: Board; live: BoardLive | null; elsewhere: boolean; showDone: boolean; tick: number }
  }
}
