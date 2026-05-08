import fs from 'node:fs/promises'
import path from 'node:path'
import type { ProjectTask, ProjectTaskSource } from '../src/repositories'
import { detectPackageManager, readPackageScripts } from './git'

type TaskCandidate = Omit<ProjectTask, 'id' | 'source'> & {
  source: ProjectTaskSource
}

const nodeTaskCategories = [
  [/dev|start|serve|watch/i, 10],
  [/test|spec|lint|type|check|format/i, 20],
  [/build|preview|package|release|dist/i, 30],
] as const

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readTextIfPresent(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function shellCommand(command: string, args: string[]) {
  return [command, ...args.map(shellQuote)].join(' ')
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "'\\''")}'`
}

function taskId(source: ProjectTaskSource, name: string) {
  return `${source}:${name}`
}

function taskSortWeight(task: ProjectTask) {
  if (task.source === 'node') {
    const category = nodeTaskCategories.find(([pattern]) => pattern.test(task.name))
    return category?.[1] ?? 40
  }

  const preferredNames = ['dev', 'server', 'bootRun', 'spring-boot:run', 'test', 'spec', 'check', 'build', 'package']
  const preferredIndex = preferredNames.indexOf(task.name)
  return preferredIndex >= 0 ? preferredIndex : 50
}

function uniqueTasks(tasks: TaskCandidate[]) {
  const byId = new Map<string, ProjectTask>()

  for (const task of tasks) {
    const id = taskId(task.source, task.name)

    if (byId.has(id)) {
      continue
    }

    byId.set(id, {
      ...task,
      id,
    })
  }

  return [...byId.values()].sort((taskA, taskB) =>
    taskSortWeight(taskA) - taskSortWeight(taskB) ||
    taskA.source.localeCompare(taskB.source) ||
    taskA.name.localeCompare(taskB.name),
  )
}

async function readNodeTasks(repoPath: string): Promise<TaskCandidate[]> {
  const scripts = await readPackageScripts(repoPath)
  const packageManager = (await detectPackageManager(repoPath)) ?? 'npm'

  return Object.keys(scripts).map((name) => ({
    name,
    command: shellCommand(packageManager, ['run', name]),
    source: 'node',
    cwd: undefined,
  }))
}

async function readGradleTasks(repoPath: string): Promise<TaskCandidate[]> {
  const gradleFiles = [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradlew',
    'gradlew.bat',
  ]
  const hasGradle = (await Promise.all(gradleFiles.map((file) => pathExists(path.join(repoPath, file)))))
    .some(Boolean)

  if (!hasGradle) {
    return []
  }

  const runner = await pathExists(path.join(repoPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
    ? process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew'
    : 'gradle'
  const buildFile = `${await readTextIfPresent(path.join(repoPath, 'build.gradle'))}\n${
    await readTextIfPresent(path.join(repoPath, 'build.gradle.kts'))
  }`
  const taskNames = ['test', 'check', 'build', 'clean']

  if (/\bapplication\b|id\(["']application["']\)|id\(["']org\.springframework\.boot["']\)/.test(buildFile)) {
    taskNames.unshift(/springframework\.boot/.test(buildFile) ? 'bootRun' : 'run')
  }

  return taskNames.map((name) => ({
    name,
    command: shellCommand(runner, [name]),
    source: 'gradle',
  }))
}

async function readMavenTasks(repoPath: string): Promise<TaskCandidate[]> {
  const pomPath = path.join(repoPath, 'pom.xml')

  if (!(await pathExists(pomPath))) {
    return []
  }

  const runner = await pathExists(path.join(repoPath, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'))
    ? process.platform === 'win32' ? '.\\mvnw.cmd' : './mvnw'
    : 'mvn'
  const pom = await readTextIfPresent(pomPath)
  const taskNames = ['test', 'package', 'verify', 'install', 'clean']

  if (pom.includes('spring-boot')) {
    taskNames.unshift('spring-boot:run')
  }

  return taskNames.map((name) => ({
    name,
    command: shellCommand(runner, [name]),
    source: 'maven',
  }))
}

async function readRailsTasks(repoPath: string): Promise<TaskCandidate[]> {
  const hasRails = await pathExists(path.join(repoPath, 'bin', 'rails')) ||
    await pathExists(path.join(repoPath, 'config', 'application.rb'))

  if (!hasRails) {
    return []
  }

  const railsCommand = await pathExists(path.join(repoPath, 'bin', 'rails'))
    ? 'bin/rails'
    : await pathExists(path.join(repoPath, 'Gemfile'))
      ? 'bundle exec rails'
      : 'rails'
  const tasks: TaskCandidate[] = [
    { name: 'server', command: `${railsCommand} server`, source: 'rails' },
    { name: 'console', command: `${railsCommand} console`, source: 'rails' },
    { name: 'test', command: `${railsCommand} test`, source: 'rails' },
    { name: 'db:migrate', command: `${railsCommand} db:migrate`, source: 'rails' },
    { name: 'routes', command: `${railsCommand} routes`, source: 'rails' },
  ]

  if (await pathExists(path.join(repoPath, 'bin', 'dev'))) {
    tasks.unshift({ name: 'dev', command: 'bin/dev', source: 'rails' })
  }

  return tasks
}

async function readRakeTasks(repoPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(path.join(repoPath, 'Rakefile')))) {
    return []
  }

  const rakeCommand = await pathExists(path.join(repoPath, 'bin', 'rake'))
    ? 'bin/rake'
    : await pathExists(path.join(repoPath, 'Gemfile'))
      ? 'bundle exec rake'
      : 'rake'
  const tasks: TaskCandidate[] = [
    { name: 'default', command: rakeCommand, source: 'rake' },
  ]

  if (await pathExists(path.join(repoPath, 'test'))) {
    tasks.push({ name: 'test', command: `${rakeCommand} test`, source: 'rake' })
  }

  if (await pathExists(path.join(repoPath, 'spec'))) {
    tasks.push({ name: 'spec', command: `${rakeCommand} spec`, source: 'rake' })
  }

  return tasks
}

export async function readProjectTasks(repoPath: string): Promise<ProjectTask[]> {
  const taskGroups = await Promise.all([
    readNodeTasks(repoPath),
    readGradleTasks(repoPath),
    readMavenTasks(repoPath),
    readRailsTasks(repoPath),
    readRakeTasks(repoPath),
  ])

  return uniqueTasks(taskGroups.flat())
}

export async function findProjectTask(repoPath: string, taskIdToFind: string) {
  const tasks = await readProjectTasks(repoPath)

  return tasks.find((task) => task.id === taskIdToFind)
}
