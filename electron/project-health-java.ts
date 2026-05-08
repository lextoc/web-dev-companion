import path from 'node:path'
import type { ProjectHealthMessage, ProjectJavaHealth } from '../src/repositories'
import {
  highestStatus,
  message,
  pathExists,
  readCommandVersion,
  readTextFile,
} from './project-health-utils'

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

export async function buildJavaHealth(repoPath: string): Promise<ProjectJavaHealth> {
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
