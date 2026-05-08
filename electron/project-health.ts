import type {
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectOutdatedDependency,
} from '../src/repositories'
import { childProcessEnv } from './process-env'
import { buildJavaHealth } from './project-health-java'
import { readNodeProjectHealth } from './project-health-node'
import { commandOutput, execFileAsync } from './project-health-utils'
import type { CommandError } from './project-health-utils'

export async function readProjectHealth(repoPath: string): Promise<ProjectHealth> {
  const [nodeHealth, java] = await Promise.all([
    readNodeProjectHealth(repoPath),
    buildJavaHealth(repoPath),
  ])

  return {
    repoPath,
    checkedAt: new Date().toISOString(),
    ...nodeHealth,
    java,
  }
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return undefined
}

function dependencyFromObject(name: string, details: unknown): ProjectOutdatedDependency {
  if (!details || typeof details !== 'object') {
    return { name }
  }

  return {
    name,
    current: stringValue('current' in details ? details.current : undefined),
    wanted: stringValue('wanted' in details ? details.wanted : undefined),
    latest: stringValue('latest' in details ? details.latest : undefined),
    type: stringValue(
      'dependencyType' in details
        ? details.dependencyType
        : 'type' in details
          ? details.type
          : 'packageType' in details
            ? details.packageType
            : undefined,
    ),
  }
}

function dependenciesFromArray(rows: unknown[]): ProjectOutdatedDependency[] {
  return rows
    .map((row) => {
      if (Array.isArray(row)) {
        const [name, current, wanted, latest, type] = row

        return stringValue(name)
          ? {
              name: stringValue(name) ?? '',
              current: stringValue(current),
              wanted: stringValue(wanted),
              latest: stringValue(latest),
              type: stringValue(type),
            }
          : undefined
      }

      if (row && typeof row === 'object') {
        const name =
          stringValue('name' in row ? row.name : undefined) ??
          stringValue('packageName' in row ? row.packageName : undefined) ??
          stringValue('package' in row ? row.package : undefined)

        return name ? dependencyFromObject(name, row) : undefined
      }

      return undefined
    })
    .filter((entry): entry is ProjectOutdatedDependency => Boolean(entry?.name))
}

function dependenciesFromObject(parsed: Record<string, unknown>): ProjectOutdatedDependency[] {
  if ('data' in parsed && parsed.data && typeof parsed.data === 'object') {
    const data = parsed.data as Record<string, unknown> | unknown[]

    if (Array.isArray(data)) {
      return dependenciesFromArray(data)
    }

    if ('body' in data && Array.isArray(data.body)) {
      return dependenciesFromArray(data.body)
    }

    return dependenciesFromObject(data)
  }

  if ('body' in parsed && Array.isArray(parsed.body)) {
    return dependenciesFromArray(parsed.body)
  }

  return Object.entries(parsed)
    .filter(([name]) => name !== 'type')
    .map(([name, details]) => dependencyFromObject(name, details))
}

function dependenciesFromText(output: string): ProjectOutdatedDependency[] {
  const dependencies: ProjectOutdatedDependency[] = []

  for (const line of output
    .trim()
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !/^package\s+/i.test(entry))) {
    const [name, current, wanted, latest, type] = line.split(/\s+/)

    if (!name) {
      continue
    }

    dependencies.push({
      name,
      current: stringValue(current),
      wanted: stringValue(wanted),
      latest: stringValue(latest),
      type: stringValue(type),
    })
  }

  return dependencies
}

function parseOutdatedDependencies(output: string): ProjectOutdatedDependency[] {
  const trimmed = output.trim()

  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown

    if (Array.isArray(parsed)) {
      return dependenciesFromArray(parsed)
    }

    if (parsed && typeof parsed === 'object') {
      return dependenciesFromObject(parsed as Record<string, unknown>)
    }
  } catch {
    const jsonLines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown
          return Array.isArray(parsed)
            ? dependenciesFromArray(parsed)
            : parsed && typeof parsed === 'object'
              ? dependenciesFromObject(parsed as Record<string, unknown>)
              : []
        } catch {
          return []
        }
      })

    return jsonLines.length > 0 ? jsonLines : dependenciesFromText(trimmed)
  }

  return []
}

function outdatedCommand(packageManager: string): { command: string; args: string[] } | undefined {
  if (packageManager === 'pnpm') {
    return { command: 'pnpm', args: ['outdated', '--format', 'json'] }
  }

  if (packageManager === 'npm') {
    return { command: 'npm', args: ['outdated', '--json'] }
  }

  if (packageManager === 'yarn') {
    return { command: 'yarn', args: ['outdated', '--json'] }
  }

  if (packageManager === 'bun') {
    return { command: 'bun', args: ['outdated'] }
  }

  return undefined
}

export async function checkProjectOutdatedDependencies(repoPath: string): Promise<ProjectDependencyHealth> {
  const { packageManager } = await readNodeProjectHealth(repoPath)
  const detected = packageManager.detected

  if (!detected) {
    return {
      status: 'skipped',
      checkedAt: new Date().toISOString(),
      error: 'No package manager detected.',
    }
  }

  const command = outdatedCommand(detected)

  if (!command) {
    return {
      status: 'skipped',
      checkedAt: new Date().toISOString(),
      error: `Outdated dependency checks are not available for ${detected}.`,
    }
  }

  try {
    const { stdout } = await execFileAsync(command.command, command.args, {
      cwd: repoPath,
      encoding: 'utf8',
      env: childProcessEnv(),
      maxBuffer: 2_000_000,
      timeout: 120000,
    })
    const outdated = parseOutdatedDependencies(stdout)
    const outdatedCount = outdated.length

    return {
      status: outdatedCount > 0 ? 'outdated' : 'ok',
      outdatedCount,
      outdated,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (error instanceof Error) {
      const commandError = error as CommandError
      const { stdout, stderr } = commandOutput(commandError)
      const outdated = parseOutdatedDependencies(stdout)
      const outdatedCount = outdated.length

      if (stdout.trim()) {
        return {
          status: outdatedCount > 0 ? 'outdated' : 'ok',
          outdatedCount,
          outdated,
          checkedAt: new Date().toISOString(),
        }
      }

      return {
        status: 'failed',
        checkedAt: new Date().toISOString(),
        error: stderr.trim() || commandError.message,
      }
    }

    return {
      status: 'failed',
      checkedAt: new Date().toISOString(),
      error: 'Outdated dependency check failed.',
    }
  }
}
