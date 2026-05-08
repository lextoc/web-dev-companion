import path from 'node:path'
import type {
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectHealthMessage,
  ProjectPackageHealth,
  ProjectScriptCheck,
} from '../src/repositories'
import { tryRunGit } from './git'
import { childProcessEnv } from './process-env'
import {
  execFileAsync,
  highestStatus,
  message,
  pathExists,
  readPackageJson,
  readTextFile,
} from './project-health-utils'
import type { PackageJson } from './project-health-utils'

const scriptCheckNames = ['test', 'typecheck', 'lint']
const packageManagerLockfiles = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
] as const

type NodeProjectHealth = Pick<
  ProjectHealth,
  'packageJsonPresent' | 'packageManager' | 'node' | 'install' | 'lockfile' | 'dependencies' | 'scripts'
>

function readDeclaredPackageManager(packageJson?: PackageJson) {
  const declared = packageJson?.packageManager

  if (typeof declared !== 'string') {
    return undefined
  }

  const trimmed = declared.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed
}

function packageManagerName(packageManager?: string) {
  if (!packageManager) {
    return undefined
  }

  const [name] = packageManager.split('@')
  return name || undefined
}

async function readLockfiles(repoPath: string) {
  const lockfiles: Array<{ file: string; packageManager: string }> = []

  for (const [file, packageManager] of packageManagerLockfiles) {
    if (await pathExists(path.join(repoPath, file))) {
      lockfiles.push({ file, packageManager })
    }
  }

  return lockfiles
}

function buildPackageHealth(packageJson: PackageJson | undefined, lockfiles: Awaited<ReturnType<typeof readLockfiles>>) {
  const declared = readDeclaredPackageManager(packageJson)
  const declaredName = packageManagerName(declared)
  const lockfileManagers = [...new Set(lockfiles.map((entry) => entry.packageManager))]
  const detected = declaredName ?? lockfileManagers[0]
  const messages: ProjectHealthMessage[] = []

  if (!declared && lockfiles.length === 0) {
    messages.push(message('warning', 'No package manager declaration or lockfile found.'))
  }

  if (lockfileManagers.length > 1) {
    messages.push(message('warning', `Multiple package manager lockfiles found: ${lockfiles.map((entry) => entry.file).join(', ')}.`))
  }

  if (declaredName && lockfileManagers.length > 0 && !lockfileManagers.includes(declaredName)) {
    messages.push(message('warning', `Declared package manager ${declaredName} does not match the lockfile.`))
  }

  return {
    detected,
    declared,
    lockfiles: lockfiles.map((entry) => entry.file),
    messages,
    status: highestStatus(messages, detected ? 'ok' : 'unknown'),
  } satisfies ProjectPackageHealth
}

async function readCurrentNodeVersion(repoPath: string) {
  try {
    const { stdout } = await execFileAsync('node', ['--version'], {
      cwd: repoPath,
      encoding: 'utf8',
      env: childProcessEnv(),
      timeout: 5000,
    })

    return stdout.trim()
  } catch {
    return undefined
  }
}

async function buildNodeHealth(repoPath: string, packageJson?: PackageJson) {
  const [current, nvmrc, nodeVersion] = await Promise.all([
    readCurrentNodeVersion(repoPath),
    readTextFile(path.join(repoPath, '.nvmrc')),
    readTextFile(path.join(repoPath, '.node-version')),
  ])
  const engines = packageJson?.engines
  const engineRange =
    engines && typeof engines === 'object' && 'node' in engines && typeof engines.node === 'string'
      ? engines.node
      : undefined
  const messages: ProjectHealthMessage[] = []

  if (!current) {
    messages.push(message('error', 'Current Node version could not be read.'))
  }

  if (nvmrc && nodeVersion && nvmrc !== nodeVersion) {
    messages.push(message('warning', '.nvmrc and .node-version do not match.'))
  }

  if (!nvmrc && !nodeVersion && !engineRange) {
    messages.push(message('warning', 'No Node version is configured.'))
  }

  return {
    current,
    configured: nvmrc ?? nodeVersion,
    engineRange,
    messages,
    status: highestStatus(messages, current ? 'ok' : 'unknown'),
  }
}

async function buildInstallHealth(repoPath: string, packageJsonPresent: boolean) {
  const installed = await pathExists(path.join(repoPath, 'node_modules'))
  const messages: ProjectHealthMessage[] = []

  if (packageJsonPresent && !installed) {
    messages.push(message('warning', 'Dependencies do not appear to be installed.'))
  }

  if (!packageJsonPresent) {
    messages.push(message('warning', 'No package.json found.'))
  }

  return {
    installed,
    messages,
    status: highestStatus(messages, packageJsonPresent ? 'ok' : 'unknown'),
  }
}

async function buildLockfileHealth(repoPath: string, packageJsonPresent: boolean, lockfiles: Awaited<ReturnType<typeof readLockfiles>>) {
  const messages: ProjectHealthMessage[] = []
  const present = lockfiles.length > 0
  const stale = false
  let dirty = false

  if (!present && packageJsonPresent) {
    messages.push(message('warning', 'No dependency lockfile found.'))
  }

  if (present) {
    const dirtyOutput = await tryRunGit(repoPath, ['status', '--short', '--', ...lockfiles.map((entry) => entry.file)])
    dirty = dirtyOutput.trim().length > 0

    if (dirty) {
      messages.push(message('warning', 'Dependency lockfile has uncommitted changes.'))
    }
  }

  return {
    dirty,
    messages,
    present,
    stale,
    status: highestStatus(messages, present ? 'ok' : 'unknown'),
  }
}

function readScripts(packageJson?: PackageJson) {
  const scripts = packageJson?.scripts

  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => {
      const [scriptName, command] = entry
      return typeof scriptName === 'string' && typeof command === 'string'
    }),
  )
}

function buildScriptChecks(packageJson?: PackageJson): ProjectScriptCheck[] {
  const scripts = readScripts(packageJson)

  return scriptCheckNames.map((name) => ({
    name,
    command: scripts[name],
    present: Boolean(scripts[name]),
    status: scripts[name] ? 'idle' : 'skipped',
  }))
}

function dependencyIdleState(packageManager?: string): ProjectDependencyHealth {
  if (!packageManager) {
    return {
      status: 'skipped',
      error: 'No package manager detected.',
    }
  }

  return { status: 'idle' }
}

export async function readNodeProjectHealth(repoPath: string): Promise<NodeProjectHealth> {
  const [{ parsed: packageJson }, lockfiles] = await Promise.all([readPackageJson(repoPath), readLockfiles(repoPath)])
  const packageJsonPresent = Boolean(packageJson)
  const packageManager = buildPackageHealth(packageJson, lockfiles)
  const [node, install, lockfile] = await Promise.all([
    buildNodeHealth(repoPath, packageJson),
    buildInstallHealth(repoPath, packageJsonPresent),
    buildLockfileHealth(repoPath, packageJsonPresent, lockfiles),
  ])

  return {
    packageJsonPresent,
    packageManager,
    node,
    install,
    lockfile,
    dependencies: dependencyIdleState(packageManager.detected),
    scripts: buildScriptChecks(packageJson),
  }
}
