import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectHealthMessage,
  ProjectHealthStatus,
  ProjectJavaHealth,
  ProjectOutdatedDependency,
  ProjectPackageHealth,
  ProjectScriptCheck,
} from '../src/repositories'
import { childProcessEnv } from './process-env'
import { tryRunGit } from './git'

const execFileAsync = promisify(execFile)
const scriptCheckNames = ['test', 'typecheck', 'lint']
const packageManagerLockfiles = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
] as const

interface PackageJson {
  packageManager?: unknown
  engines?: unknown
  scripts?: unknown
}

interface CommandError extends Error {
  code?: string | number
  killed?: boolean
  signal?: string | null
  stdout?: string | Buffer
  stderr?: string | Buffer
}

function message(level: ProjectHealthMessage['level'], text: string): ProjectHealthMessage {
  return { level, text }
}

function highestStatus(messages: ProjectHealthMessage[], fallback: ProjectHealthStatus = 'ok') {
  if (messages.some((entry) => entry.level === 'error')) {
    return 'error'
  }

  if (messages.some((entry) => entry.level === 'warning')) {
    return 'warning'
  }

  return fallback
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readTextFile(filePath: string) {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim()
  } catch {
    return undefined
  }
}

async function readPackageJson(repoPath: string): Promise<{ parsed?: PackageJson; raw?: string }> {
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8')
    return { parsed: JSON.parse(raw) as PackageJson, raw }
  } catch {
    return {}
  }
}

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
    try {
      await fs.access(path.join(repoPath, file))
      lockfiles.push({ file, packageManager })
    } catch {
      continue
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
  let stale = false
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

function firstLine(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

async function readCommandVersion(repoPath: string, command: string, args: string[]) {
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

function majorFromVersionText(value?: string) {
  if (!value) {
    return undefined
  }

  const match = value.match(/(?:version\s+|javac\s+)?["']?(\d+)(?:\.(\d+))?/i)

  if (!match) {
    return undefined
  }

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major === 1 && Number.isFinite(minor)) {
    return minor
  }

  return Number.isFinite(major) ? major : undefined
}

function normalizeJavaRelease(value?: string) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  const versionMatch = trimmed.match(/(?:VERSION_)?(\d+)(?:\.(\d+))?/i)

  if (!versionMatch) {
    return undefined
  }

  const major = Number(versionMatch[1])
  const minor = Number(versionMatch[2])

  if (!Number.isFinite(major)) {
    return undefined
  }

  return {
    label: major === 1 && Number.isFinite(minor) ? String(minor) : String(major),
    major: major === 1 && Number.isFinite(minor) ? minor : major,
  }
}

function readXmlTagValue(xml: string, tagName: string) {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tagPattern = new RegExp(`<${escapedTagName}\\b[^>]*>([^<]+)</${escapedTagName}>`, 'i')
  return xml.match(tagPattern)?.[1]?.trim()
}

function readPomProperties(pom: string) {
  const properties = new Map<string, string>()
  const propertiesBlock = pom.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/i)?.[1]

  if (!propertiesBlock) {
    return properties
  }

  for (const match of propertiesBlock.matchAll(/<([\w.-]+)\b[^>]*>([^<]+)<\/\1>/g)) {
    properties.set(match[1], match[2].trim())
  }

  return properties
}

function resolvePomValue(value: string | undefined, properties: Map<string, string>) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  let resolved: string = trimmed

  for (let index = 0; index < 5; index += 1) {
    const replaced = resolved.replace(/\$\{([^}]+)}/g, (match, propertyName: string) =>
      properties.get(propertyName.trim()) ?? match,
    )

    if (replaced === resolved) {
      break
    }

    resolved = replaced
  }

  return resolved
}

function readMavenCompilerPluginBlock(pom: string) {
  return [...pom.matchAll(/<plugin\b[\s\S]*?<\/plugin>/gi)]
    .map((match) => match[0])
    .find((plugin) => /<artifactId\b[^>]*>\s*maven-compiler-plugin\s*<\/artifactId>/i.test(plugin))
}

async function readMavenJavaRelease(repoPath: string) {
  const pom = await readTextFile(path.join(repoPath, 'pom.xml'))

  if (!pom) {
    return undefined
  }

  const properties = readPomProperties(pom)
  const compilerPlugin = readMavenCompilerPluginBlock(pom)
  const candidates = [
    readXmlTagValue(pom, 'maven.compiler.release'),
    compilerPlugin ? readXmlTagValue(compilerPlugin, 'release') : undefined,
    readXmlTagValue(pom, 'maven.compiler.target'),
    compilerPlugin ? readXmlTagValue(compilerPlugin, 'target') : undefined,
    readXmlTagValue(pom, 'maven.compiler.source'),
    compilerPlugin ? readXmlTagValue(compilerPlugin, 'source') : undefined,
    readXmlTagValue(pom, 'java.version'),
  ]

  for (const candidate of candidates) {
    const resolved = resolvePomValue(candidate, properties)
    const normalized = normalizeJavaRelease(resolved)

    if (normalized) {
      return normalized
    }
  }

  return undefined
}

async function readGradleJavaRelease(repoPath: string) {
  const buildFiles = await Promise.all([
    readTextFile(path.join(repoPath, 'build.gradle')),
    readTextFile(path.join(repoPath, 'build.gradle.kts')),
  ])
  const buildFile = buildFiles.filter(Boolean).join('\n')

  if (!buildFile) {
    return undefined
  }

  const patterns = [
    /languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/,
    /java\.toolchain\.languageVersion\.set\(JavaLanguageVersion\.of\((\d+)\)\)/,
    /jvmToolchain\((\d+)\)/,
    /sourceCompatibility\s*=\s*(?:JavaVersion\.)?["']?(VERSION_\d+|\d+(?:\.\d+)?)["']?/,
    /targetCompatibility\s*=\s*(?:JavaVersion\.)?["']?(VERSION_\d+|\d+(?:\.\d+)?)["']?/,
  ]

  for (const pattern of patterns) {
    const normalized = normalizeJavaRelease(buildFile.match(pattern)?.[1])

    if (normalized) {
      return normalized
    }
  }

  return undefined
}

async function readConfiguredJavaVersion(repoPath: string) {
  const [javaVersion, sdkmanrc] = await Promise.all([
    readTextFile(path.join(repoPath, '.java-version')),
    readTextFile(path.join(repoPath, '.sdkmanrc')),
  ])
  const sdkmanJava = sdkmanrc
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('java='))
    ?.slice('java='.length)
    .trim()

  return javaVersion ?? sdkmanJava
}

async function buildJavaHealth(repoPath: string): Promise<ProjectJavaHealth> {
  const [
    mavenWrapperPresent,
    gradleWrapperPresent,
    mavenRelease,
    gradleRelease,
    hasMavenProject,
    hasGradleProject,
  ] = await Promise.all([
    pathExists(path.join(repoPath, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw')),
    pathExists(path.join(repoPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')),
    readMavenJavaRelease(repoPath),
    readGradleJavaRelease(repoPath),
    pathExists(path.join(repoPath, 'pom.xml')),
    Promise.all([
      pathExists(path.join(repoPath, 'build.gradle')),
      pathExists(path.join(repoPath, 'build.gradle.kts')),
      pathExists(path.join(repoPath, 'settings.gradle')),
      pathExists(path.join(repoPath, 'settings.gradle.kts')),
    ]).then((entries) => entries.some(Boolean)),
  ])
  const hasJavaProject = hasMavenProject || hasGradleProject || mavenWrapperPresent || gradleWrapperPresent
  const requiredRelease = mavenRelease ?? gradleRelease
  const baseHealth = {
    mavenWrapperPresent,
    gradleWrapperPresent,
    requiredRelease: requiredRelease?.label,
    requiredMajor: requiredRelease?.major,
    javaHome: process.env.JAVA_HOME,
  }

  if (!hasJavaProject) {
    return {
      ...baseHealth,
      messages: [],
      status: 'unknown',
    }
  }

  const [current, compiler, maven, configured] = await Promise.all([
    readCommandVersion(repoPath, 'java', ['-version']),
    readCommandVersion(repoPath, 'javac', ['-version']),
    hasMavenProject && !mavenWrapperPresent ? readCommandVersion(repoPath, 'mvn', ['-v']) : undefined,
    readConfiguredJavaVersion(repoPath),
  ])
  const compilerMajor = majorFromVersionText(compiler)
  const configuredMajor = majorFromVersionText(configured)
  const messages: ProjectHealthMessage[] = []

  if (!current) {
    messages.push(message('error', 'Current Java runtime could not be read.'))
  }

  if (!compiler) {
    messages.push(message('error', 'Current Java compiler could not be read.'))
  }

  if (hasMavenProject && !mavenWrapperPresent && !maven) {
    messages.push(message('error', 'Maven is not available and no Maven wrapper was found.'))
  }

  if (requiredRelease && compilerMajor && requiredRelease.major > compilerMajor) {
    messages.push(
      message(
        'error',
        `Project requires Java ${requiredRelease.label}, but active javac is ${compilerMajor}.`,
      ),
    )
  }

  if (configured && configuredMajor && compilerMajor && configuredMajor !== compilerMajor) {
    messages.push(message('warning', `Configured Java ${configured} does not match active javac ${compilerMajor}.`))
  }

  return {
    ...baseHealth,
    current,
    compiler,
    compilerMajor,
    configured,
    maven,
    messages,
    status: highestStatus(messages),
  }
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

export async function readProjectHealth(repoPath: string): Promise<ProjectHealth> {
  const [{ parsed: packageJson }, lockfiles] = await Promise.all([readPackageJson(repoPath), readLockfiles(repoPath)])
  const packageJsonPresent = Boolean(packageJson)
  const packageManager = buildPackageHealth(packageJson, lockfiles)
  const [node, java, install, lockfile] = await Promise.all([
    buildNodeHealth(repoPath, packageJson),
    buildJavaHealth(repoPath),
    buildInstallHealth(repoPath, packageJsonPresent),
    buildLockfileHealth(repoPath, packageJsonPresent, lockfiles),
  ])

  return {
    repoPath,
    checkedAt: new Date().toISOString(),
    packageJsonPresent,
    packageManager,
    node,
    java,
    install,
    lockfile,
    dependencies: dependencyIdleState(packageManager.detected),
    scripts: buildScriptChecks(packageJson),
  }
}

function commandOutput(error: CommandError) {
  const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : error.stdout ?? ''
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : error.stderr ?? ''

  return { stdout, stderr }
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
  const { packageManager } = await readProjectHealth(repoPath)
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
