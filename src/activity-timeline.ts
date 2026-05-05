import type { GitLogEntry, RepositoryDetails } from './repositories'

export type RepositoryActivityKind =
  | 'app-commit'
  | 'branch-sync'
  | 'error'
  | 'git-commit'
  | 'script'
  | 'status'

export type RepositoryActivityTone = 'error' | 'info' | 'neutral' | 'success' | 'warning'

export interface RepositoryLocalActivity {
  id: string
  repoPath: string
  kind: Exclude<RepositoryActivityKind, 'git-commit'>
  title: string
  description?: string
  meta?: string
  occurredAt: string
  tone: RepositoryActivityTone
}

export interface RepositoryTimelineItem {
  id: string
  kind: RepositoryActivityKind
  title: string
  description?: string
  eyebrow: string
  meta?: string
  occurredAt: string
  timeLabel: string
  tone: RepositoryActivityTone
  hash?: string
}

export interface RepositoryActivityInput {
  repoPath: string
  kind: RepositoryLocalActivity['kind']
  title: string
  description?: string
  meta?: string
  tone?: RepositoryActivityTone
}

const MAX_LOCAL_ACTIVITY_PER_REPOSITORY = 60

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatActivityTime(dateTime: string) {
  const date = new Date(dateTime)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function activityTimestamp(item: Pick<RepositoryTimelineItem, 'occurredAt'>) {
  const timestamp = Date.parse(item.occurredAt)

  return Number.isNaN(timestamp) ? 0 : timestamp
}

function gitCommitTimelineItem(entry: GitLogEntry): RepositoryTimelineItem {
  return {
    id: `commit-${entry.hash}`,
    kind: 'git-commit',
    title: entry.message,
    description: `${entry.authorName} / ${entry.authorEmail}`,
    eyebrow: 'Commit',
    meta: entry.hash,
    occurredAt: entry.dateTime,
    timeLabel: entry.time || formatActivityTime(entry.dateTime),
    tone: 'neutral',
    hash: entry.hash,
  }
}

function localActivityTimelineItem(activity: RepositoryLocalActivity): RepositoryTimelineItem {
  return {
    id: activity.id,
    kind: activity.kind,
    title: activity.title,
    description: activity.description,
    eyebrow: activity.kind
      .split('-')
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(' '),
    meta: activity.meta,
    occurredAt: activity.occurredAt,
    timeLabel: formatActivityTime(activity.occurredAt),
    tone: activity.tone,
  }
}

export function createRepositoryActivity(input: RepositoryActivityInput): RepositoryLocalActivity {
  return {
    id: nowId(),
    repoPath: input.repoPath,
    kind: input.kind,
    title: input.title,
    description: input.description,
    meta: input.meta,
    occurredAt: new Date().toISOString(),
    tone: input.tone ?? 'info',
  }
}

export function appendRepositoryActivity(
  activitiesByRepositoryPath: Record<string, RepositoryLocalActivity[]>,
  activity: RepositoryLocalActivity,
) {
  return {
    ...activitiesByRepositoryPath,
    [activity.repoPath]: [
      activity,
      ...(activitiesByRepositoryPath[activity.repoPath] ?? []),
    ].slice(0, MAX_LOCAL_ACTIVITY_PER_REPOSITORY),
  }
}

export function buildRepositoryTimeline(
  details: RepositoryDetails | null,
  localActivities: RepositoryLocalActivity[],
) {
  if (!details) {
    return []
  }

  return [
    ...details.gitLog.map(gitCommitTimelineItem),
    ...localActivities.map(localActivityTimelineItem),
  ].sort((itemA, itemB) => activityTimestamp(itemB) - activityTimestamp(itemA))
}
