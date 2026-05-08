import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type { ProjectTask, ScriptOutput, ScriptRunRequest } from '../src/repositories'
import { normalizeRepositoryPath } from './git'
import { childProcessEnv } from './process-env'
import { findProjectTask } from './project-tasks'

interface ScriptRunnerOptions {
  sendOutput: (output: ScriptOutput) => void
}

function launchCommand(command: string) {
  if (process.platform === 'win32') {
    return {
      command,
      args: [],
      shell: true,
    }
  }

  if (process.platform === 'darwin') {
    return {
      command: process.env.SHELL || '/bin/zsh',
      args: ['-ilc', command],
      shell: false,
    }
  }

  return {
    command: process.env.SHELL || '/bin/sh',
    args: ['-lc', command],
    shell: false,
  }
}

function taskCwd(repoPath: string, task: ProjectTask) {
  return task.cwd ? path.resolve(repoPath, task.cwd) : repoPath
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

  function launchScript(runId: string, repoPath: string, task: ProjectTask) {
    if (!pendingScriptRuns.has(runId)) {
      return
    }

    pendingScriptRuns.delete(runId)

    const launch = launchCommand(task.command)
    const child = spawn(launch.command, launch.args, {
      cwd: taskCwd(repoPath, task),
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
    const task = await findProjectTask(repoPath, request.taskId)

    if (!task) {
      throw new Error(`Task "${request.taskId}" was not found.`)
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    pendingScriptRuns.add(runId)
    setTimeout(() => {
      launchScript(runId, repoPath, task)
    }, 0)

    return {
      runId,
      command: task.command,
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
