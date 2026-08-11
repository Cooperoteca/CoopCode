// Board task shapes shared by the main-process loader, the preload bridge and the
// renderer. They live in shared/ because a type import from main/ pulls its whole
// runtime graph (git runner, observability, win32 helpers) into the renderer
// tsconfig, which cannot compile it.

export type CoopTaskState = 'draft' | 'ready' | 'working' | 'review' | 'done' | 'blocked'

export type CoopTaskIntegration = {
  reviewDecision?: string
  resultSha?: string
  mergeCommit?: string
}

export type CoopTaskEvidenceFile = {
  name: string
  relativePath: string
  absolutePath: string
  size: number
  extension: string
  fileType: 'image' | 'text' | 'json' | 'markdown' | 'other'
}

export type CoopTaskAttentionCategory = 'blocked' | 'rework' | 'loop_stop'

export type CoopTaskAttention = {
  needed: boolean
  category?: CoopTaskAttentionCategory
  reason?: string
  stalledAt?: number
}

export type CoopBoardTask = {
  id: string
  title: string
  state: CoopTaskState
  frontmatterState: CoopTaskState
  priority: string
  risk: string
  dependsOn: string[]
  blockedOn: string[]
  blocked: boolean
  blockingReasons: string[]
  worktreePath?: string
  branch?: string
  integration?: CoopTaskIntegration
  evidenceFiles: CoopTaskEvidenceFile[]
  evidenceClaimed: boolean
  evidenceMissing: boolean
  attention?: CoopTaskAttention
  mtimeMs?: number
}

export type CoopBoardResult = {
  repoRoot: string
  tasks: CoopBoardTask[]
  error?: string
}
