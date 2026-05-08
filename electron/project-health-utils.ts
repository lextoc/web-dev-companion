import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ProjectHealthMessage, ProjectHealthStatus } from '../src/repositories'
import { childProcessEnv } from './process-env'

export const execFileAsync = promisify(execFile)

export interface PackageJson {
  packageManager?: unknown
  engines?: unknown
  scripts?: unknown
}

export interface CommandError extends Error {
  code?: string | number
  killed?: boolean
  signal?: string | null
  stdout?: string | Buffer
  stderr?: string | Buffer
}

export function message(level: ProjectHealthMessage['level'], text: string): ProjectHealthMessage {
  return { level, text }
}

export function highestStatus(messages: ProjectHealthMessage[], fallback: ProjectHealthStatus = 'ok') {
  if (messages.some((entry) => entry.level === 'error')) {
    return 'error'
  }

  if (messages.some((entry) => entry.level === 'warning')) {
    return 'warning'
  }

  return fallback
}

export async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readTextFile(filePath: string) {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim()
  } catch {
    return undefined
  }
}

export async function readPackageJson(repoPath: string): Promise<{ parsed?: PackageJson; raw?: string }> {
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8')
    return { parsed: JSON.parse(raw) as PackageJson, raw }
  } catch {
    return {}
  }
}

function firstLine(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

export async function readCommandVersion(repoPath: string, command: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: repoPath,
      encoding: 'utf8',
      env: childProcessEnv(),
      timeout: 5000,
    })

    return firstLine(`${stdout}\n${stderr}`)
  } catch {
    return undefined
  }
}

export function commandOutput(error: CommandError) {
  const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : error.stdout ?? ''
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : error.stderr ?? ''

  return { stdout, stderr }
}
