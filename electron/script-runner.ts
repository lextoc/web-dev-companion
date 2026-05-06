import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ScriptOutput, ScriptRunRequest } from '../src/repositories'
import {
  detectPackageManager,
  normalizeRepositoryPath,
  readPackageScripts,
} from './git'
import { childProcessEnv } from './process-env'

interface ScriptRunnerOptions {
  sendOutput: (output: ScriptOutput) => void
}

function commandForPackageManager(packageManager: string | undefined) {
  return packageManager || 'npm'
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function scriptCommand(packageManager: string, scriptName: string) {
  return `${shellQuote(packageManager)} run ${shellQuote(scriptName)}`
}

function launchCommand(packageManager: string, scriptName: string) {
  if (process.platform === 'win32') {
    return {
      command: packageManager,
      args: ['run', scriptName],
      shell: true,
    }
  }

  if (process.platform === 'darwin') {
    return {
      command: process.env.SHELL || '/bin/zsh',
      args: ['-ilc', scriptCommand(packageManager, scriptName)],
      shell: false,
    }
  }

  return {
    command: process.env.SHELL || '/bin/sh',
    args: ['-lc', scriptCommand(packageManager, scriptName)],
    shell: false,
  }
}

export function createScriptRunner({ sendOutput }: ScriptRunnerOptions) {
  const runningScripts = new Map<string, ChildProcessWithoutNullStreams>()
  const pendingScriptRuns = new Set<string>()

  function terminateScriptProcess(child: ChildProcessWithoutNullStreams) {
    if (process.platform === 'win32') {
      if (child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        })

        killer.once('error', () => {
          child.kill('SIGTERM')
        })
        return
      }

      child.kill('SIGTERM')
      return
    }

    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
        return
      } catch {
        child.kill('SIGTERM')
      }
    }
  }

  function launchScript(runId: string, repoPath: string, packageManager: string, scriptName: string) {
    if (!pendingScriptRuns.has(runId)) {
      return
    }

    pendingScriptRuns.delete(runId)

    const launch = launchCommand(packageManager, scriptName)
    const child = spawn(launch.command, launch.args, {
      cwd: repoPath,
      detached: process.platform !== 'win32',
      env: childProcessEnv(),
      shell: launch.shell,
      windowsHide: true,
    })

    runningScripts.set(runId, child)

    child.stdout.on('data', (chunk: Buffer) => {
      sendOutput({
        runId,
        stream: 'stdout',
        text: chunk.toString(),
      })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      sendOutput({
        runId,
        stream: 'stderr',
        text: chunk.toString(),
      })
    })

    child.on('error', (error) => {
      sendOutput({
        runId,
        stream: 'system',
        text: `${error.message}\n`,
        done: true,
      })
      runningScripts.delete(runId)
    })

    child.on('close', (exitCode, signal) => {
      sendOutput({
        runId,
        stream: 'system',
        text: `\nProcess ${signal ? `stopped with ${signal}` : `exited with code ${exitCode ?? 0}`}.\n`,
        exitCode,
        signal,
        done: true,
      })
      runningScripts.delete(runId)
    })
  }

  async function startScript(request: ScriptRunRequest) {
    const repoPath = await normalizeRepositoryPath(request.repoPath)
    const npmScripts = await readPackageScripts(repoPath)

    if (!npmScripts[request.scriptName]) {
      throw new Error(`Script "${request.scriptName}" was not found.`)
    }

    const packageManager = commandForPackageManager(request.packageManager || (await detectPackageManager(repoPath)))
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const command = `${packageManager} run ${request.scriptName}`

    pendingScriptRuns.add(runId)
    setTimeout(() => {
      launchScript(runId, repoPath, packageManager, request.scriptName)
    }, 0)

    return {
      runId,
      command,
    }
  }

  function stopScript(runId: string) {
    if (pendingScriptRuns.delete(runId)) {
      sendOutput({
        runId,
        stream: 'system',
        text: '\nProcess stopped before it started.\n',
        done: true,
      })

      return true
    }

    const child = runningScripts.get(runId)

    if (!child) {
      return false
    }

    terminateScriptProcess(child)

    return true
  }

  function stopAllScripts() {
    for (const runId of pendingScriptRuns) {
      stopScript(runId)
    }

    for (const child of runningScripts.values()) {
      terminateScriptProcess(child)
    }

    runningScripts.clear()
  }

  return {
    startScript,
    stopAllScripts,
    stopScript,
  }
}
