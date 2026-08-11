import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { ipcMain } from 'electron'
import { gitExecFileAsync } from '../git/runner'
import type {
  CoopBoardResult,
  CoopBoardTask,
  CoopTaskAttentionCategory,
  CoopTaskEvidenceFile,
  CoopTaskIntegration,
  CoopTaskState
} from '../../shared/coop-board-types'


export type {
  CoopBoardResult,
  CoopBoardTask,
  CoopTaskAttention,
  CoopTaskAttentionCategory,
  CoopTaskEvidenceFile,
  CoopTaskIntegration,
  CoopTaskState
} from '../../shared/coop-board-types'

type CoopTaskFrontmatter = {
  id?: unknown
  title?: unknown
  state?: unknown
  priority?: unknown
  risk?: unknown
  depends_on?: unknown
  blocked_on?: unknown
}

type WorktreeRecord = {
  worktreePath?: string
  branch?: string
}

type LoadCoopBoardOptions = {
  repoRoot: string
  worktreePorcelain?: string
}

const TASK_STATE_VALUES = new Set(['draft', 'ready', 'working', 'review', 'done', 'blocked'])

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asTaskState(value: unknown): CoopTaskState {
  return typeof value === 'string' && TASK_STATE_VALUES.has(value) ? (value as CoopTaskState) : 'draft'
}

function parseFrontmatter(text: string): CoopTaskFrontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) {
    throw new Error('Task file is missing frontmatter')
  }
  return JSON.parse(match[1]) as CoopTaskFrontmatter
}

function cleanIntegrationValue(value: string): string {
  return value.trim().replace(/^`|`$/g, '')
}

function parseIntegration(text: string): CoopTaskIntegration | undefined {
  const marker = '## Integration'
  const markerIndex = text.lastIndexOf(marker)
  if (markerIndex === -1) {
    return undefined
  }
  const section = text.slice(markerIndex + marker.length)
  const reviewDecision = section.match(/Review decision:\s*([^\r\n]+)/)
  const resultSha = section.match(/Result SHA:\s*([^\r\n]+)/)
  const mergeCommit = section.match(/Merge commit:\s*([^\r\n]+)/)
  const integration: CoopTaskIntegration = {}
  if (reviewDecision) {
    integration.reviewDecision = cleanIntegrationValue(reviewDecision[1])
  }
  if (resultSha) {
    integration.resultSha = cleanIntegrationValue(resultSha[1])
  }
  if (mergeCommit) {
    integration.mergeCommit = cleanIntegrationValue(mergeCommit[1])
  }
  return Object.keys(integration).length > 0 ? integration : undefined
}

function parseWorktreePorcelain(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let current: WorktreeRecord | null = null
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) {
        records.push(current)
        current = null
      }
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current) {
        records.push(current)
      }
      current = { worktreePath: line.slice('worktree '.length) }
      continue
    }
    if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length)
    }
  }
  if (current) {
    records.push(current)
  }
  return records
}

async function getWorktreePorcelain(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await gitExecFileAsync(['worktree', 'list', '--porcelain'], { cwd: repoRoot })
    return stdout
  } catch (err) {
    const text = err instanceof Error ? err.message : ''
    throw new Error(text || 'git worktree list failed')
  }
}

function worktreeByTaskId(records: WorktreeRecord[]): Map<string, WorktreeRecord> {
  const byTaskId = new Map<string, WorktreeRecord>()
  for (const record of records) {
    const branch = record.branch ?? ''
    // Why: prepare-task.mjs creates task/<id-lowercase> for any task id shape (DEVX-040, PLAT-013), not just devx-N.
    const match = branch.match(/^refs\/heads\/task\/(.+)$/)
    if (match) {
      byTaskId.set(match[1].toUpperCase(), record)
    }
  }
  return byTaskId
}

function compareTaskIds(a: string, b: string): number {
  const aNumber = Number(a.match(/\d+$/)?.[0] ?? Number.NaN)
  const bNumber = Number(b.match(/\d+$/)?.[0] ?? Number.NaN)
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber
  }
  return a.localeCompare(b)
}

function computeBlocking(tasks: CoopBoardTask[]): CoopBoardTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return tasks.map((task) => {
    const reasons: string[] = []
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId)
      if (!dependency) {
        reasons.push(`Missing dependency ${dependencyId}`)
      } else if (dependency.state !== 'done') {
        reasons.push(`${dependencyId} is ${dependency.state}`)
      }
    }
    for (const externalBlock of task.blockedOn) {
      reasons.push(externalBlock)
    }
    return {
      ...task,
      blocked: reasons.length > 0,
      blockingReasons: reasons
    }
  })
}

function getFileType(extension: string): CoopTaskEvidenceFile['fileType'] {
  const ext = extension.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image'
  }
  if (ext === 'json') {
    return 'json'
  }
  if (['md', 'markdown'].includes(ext)) {
    return 'markdown'
  }
  if (['txt', 'log'].includes(ext)) {
    return 'text'
  }
  return 'other'
}

export function isEvidenceClaimed(text: string): boolean {
  const matchSection = text.match(/##\s+(?:Acceptance|Handoff)[\s\S]*?(?=\n##\s+|$)/gi)
  const targetText = matchSection ? matchSection.join('\n') : text
  const pattern = /hands-on\s+evidence|evidênci?a[s]?\s+hands-on|verificaçã[o|ões]?\s+hands-on/i
  return pattern.test(targetText)
}

async function loadEvidenceFilesMap(repoRoot: string): Promise<Map<string, CoopTaskEvidenceFile[]>> {
  const evidenceMap = new Map<string, CoopTaskEvidenceFile[]>()
  const evidenceDir = path.join(repoRoot, 'docs', 'planning', 'evidence')
  try {
    const entries = await readdir(evidenceDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const name = entry.name
      const match = name.match(/^([a-zA-Z0-9]+-[a-zA-Z0-9]+)-/i)
      if (!match) continue
      const taskId = match[1].toUpperCase()
      const absolutePath = path.join(evidenceDir, name)
      const relativePath = path.join('docs', 'planning', 'evidence', name).replace(/\\/g, '/')
      let size = 0
      try {
        const stats = await stat(absolutePath)
        size = stats.size
      } catch {
        // ignore stat errors
      }
      const ext = path.extname(name).slice(1)
      const fileObj: CoopTaskEvidenceFile = {
        name,
        relativePath,
        absolutePath,
        size,
        extension: ext.toLowerCase(),
        fileType: getFileType(ext)
      }
      const existing = evidenceMap.get(taskId) ?? []
      existing.push(fileObj)
      evidenceMap.set(taskId, existing)
    }
  } catch {
    // ignore missing directory
  }

  for (const files of evidenceMap.values()) {
    files.sort((a, b) => a.name.localeCompare(b.name))
  }
  return evidenceMap
}

async function readTaskFile(
  taskPath: string,
  liveWorktrees: Map<string, WorktreeRecord>,
  evidenceMap: Map<string, CoopTaskEvidenceFile[]>
): Promise<CoopBoardTask> {
  const fileStat = await stat(taskPath)
  const text = await readFile(taskPath, 'utf8')
  const frontmatter = parseFrontmatter(text)
  const id = asString(frontmatter.id)
  const frontmatterState = asTaskState(frontmatter.state)
  const liveWorktree = liveWorktrees.get(id)
  const state = frontmatterState !== 'done' && liveWorktree ? 'working' : frontmatterState

  const evidenceFiles = evidenceMap.get(id.toUpperCase()) ?? []
  const evidenceClaimed = isEvidenceClaimed(text)
  const evidenceMissing = evidenceClaimed && evidenceFiles.length === 0

  return {
    id,
    title: asString(frontmatter.title),
    state,
    frontmatterState,
    priority: asString(frontmatter.priority),
    risk: asString(frontmatter.risk),
    dependsOn: asStringArray(frontmatter.depends_on),
    blockedOn: asStringArray(frontmatter.blocked_on),
    blocked: false,
    blockingReasons: [],
    worktreePath: liveWorktree?.worktreePath,
    branch: liveWorktree?.branch,
    integration: parseIntegration(text),
    evidenceFiles,
    evidenceClaimed,
    evidenceMissing,
    mtimeMs: fileStat.mtimeMs
  }
}

type LoopLogStopInfo = {
  stopLine: string
  isClean: boolean
  mtimeMs: number
}

function parseStopLine(text: string): { stopLine: string; isClean: boolean } | undefined {
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('Stop:')) {
      const stopLineText = line.slice('Stop:'.length).trim()
      const lower = stopLineText.toLowerCase()
      const isBudgetExhausted = lower.includes('budget_exhausted')
      const isCeilingOrMaxTasks = lower.includes('max_tasks') || lower.includes('ceiling')
      const isClean = isBudgetExhausted && isCeilingOrMaxTasks
      return { stopLine: stopLineText, isClean }
    }
  }
  return undefined
}

async function loadLoopLogMap(evidenceRoot: string): Promise<Map<string, LoopLogStopInfo>> {
  const logMap = new Map<string, LoopLogStopInfo>()
  try {
    const entries = await readdir(evidenceRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('-log.md')) {
        const match = entry.name.match(/^([A-Z0-9]+-\d+).*-log\.md$/i)
        if (match) {
          const taskId = match[1].toUpperCase()
          const logPath = path.join(evidenceRoot, entry.name)
          try {
            const fileStat = await stat(logPath)
            const text = await readFile(logPath, 'utf8')
            const parsed = parseStopLine(text)
            if (parsed) {
              logMap.set(taskId, {
                stopLine: parsed.stopLine,
                isClean: parsed.isClean,
                mtimeMs: fileStat.mtimeMs
              })
            }
          } catch {
            // Ignore unreadable log file
          }
        }
      }
    }
  } catch {
    // Evidence directory might not exist
  }
  return logMap
}

function computeAttention(
  tasks: CoopBoardTask[],
  logMap: Map<string, LoopLogStopInfo>
): CoopBoardTask[] {
  return tasks.map((task) => {
    if (task.state === 'done') {
      return {
        ...task,
        attention: { needed: false }
      }
    }

    const logInfo = logMap.get(task.id)
    const hasNonCleanLogStop = Boolean(logInfo && !logInfo.isClean)
    const reviewDecision = task.integration?.reviewDecision?.toLowerCase()
    const hasReworkVerdict = reviewDecision === 'rework' || reviewDecision === 'blocked'
    const isBlocked = task.blocked || task.blockedOn.length > 0

    if (!hasNonCleanLogStop && !hasReworkVerdict && !isBlocked) {
      return {
        ...task,
        attention: { needed: false }
      }
    }

    let category: CoopTaskAttentionCategory = 'blocked'
    let reason = ''
    let stalledAt = task.mtimeMs ?? 0

    if (hasNonCleanLogStop) {
      category = 'loop_stop'
      reason = `Loop stopped: ${logInfo?.stopLine}`
      stalledAt = logInfo?.mtimeMs || stalledAt
    } else if (hasReworkVerdict) {
      category = 'rework'
      reason = `Review decision: ${task.integration?.reviewDecision}`
    } else if (isBlocked) {
      category = 'blocked'
      const reasonsText =
        task.blockingReasons.length > 0 ? task.blockingReasons.join(', ') : task.blockedOn.join(', ')
      reason = `Blocked by ${reasonsText}`
    }

    return {
      ...task,
      attention: {
        needed: true,
        category,
        reason,
        stalledAt
      }
    }
  })
}

const RISK_RANK: Record<string, number> = {
  high: 0,
  routine: 1
}

function getRiskRank(risk: string): number {
  return RISK_RANK[risk.toLowerCase()] ?? 2
}

function getPriorityRank(priority: string): number {
  const match = priority.match(/^P(\d+)$/i)
  return match ? parseInt(match[1], 10) : 99
}

export function compareAttentionTasks(a: CoopBoardTask, b: CoopBoardTask): number {
  const riskDiff = getRiskRank(a.risk) - getRiskRank(b.risk)
  if (riskDiff !== 0) return riskDiff

  const priorityDiff = getPriorityRank(a.priority) - getPriorityRank(b.priority)
  if (priorityDiff !== 0) return priorityDiff

  const aStalled = a.attention?.stalledAt ?? a.mtimeMs ?? 0
  const bStalled = b.attention?.stalledAt ?? b.mtimeMs ?? 0
  if (bStalled !== aStalled) {
    return bStalled - aStalled
  }

  return compareTaskIds(a.id, b.id)
}

export async function loadCoopBoard(options: LoadCoopBoardOptions): Promise<CoopBoardResult> {
  const repoRoot = path.resolve(options.repoRoot)
  const tasksRoot = path.join(repoRoot, 'docs', 'coop', 'tasks')
  const evidenceRoot = path.join(repoRoot, 'docs', 'planning', 'evidence')
  const porcelain = options.worktreePorcelain ?? (await getWorktreePorcelain(repoRoot))
  const liveWorktrees = worktreeByTaskId(parseWorktreePorcelain(porcelain))
  const evidenceMap = await loadEvidenceFilesMap(repoRoot)
  const entries = await readdir(tasksRoot, { withFileTypes: true })
  const taskFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(tasksRoot, entry.name))
  const [tasks, logMap] = await Promise.all([
    Promise.all(taskFiles.map((taskPath) => readTaskFile(taskPath, liveWorktrees, evidenceMap))),
    loadLoopLogMap(evidenceRoot)
  ])
  tasks.sort((a, b) => compareTaskIds(a.id, b.id))
  const blockedTasks = computeBlocking(tasks)
  const tasksWithAttention = computeAttention(blockedTasks, logMap)
  return {
    repoRoot,
    tasks: tasksWithAttention
  }
}

export function registerCoopBoardHandlers(): void {
  ipcMain.handle('coopBoard:listTasks', async (_event, args: { repoRoot?: unknown }) => {
    if (typeof args?.repoRoot !== 'string' || !args.repoRoot.trim()) {
      return { repoRoot: '', tasks: [], error: 'repoRoot is required' } satisfies CoopBoardResult
    }
    try {
      return await loadCoopBoard({ repoRoot: args.repoRoot })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { repoRoot: args.repoRoot, tasks: [], error: message } satisfies CoopBoardResult
    }
  })

  ipcMain.handle('coopBoard:readEvidenceFile', async (_event, args: { filePath?: unknown }) => {
    if (typeof args?.filePath !== 'string' || !args.filePath.trim()) {
      throw new Error('filePath is required')
    }
    const resolvedPath = path.resolve(args.filePath)
    const ext = path.extname(resolvedPath).slice(1).toLowerCase()
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
    const content = await readFile(resolvedPath)
    if (isImg) {
      const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      return { content: `data:${mimeType};base64,${content.toString('base64')}`, isImage: true }
    }
    return { content: content.toString('utf8'), isImage: false }
  })
}

