import { computed, ref, type Ref } from 'vue'
import type { PinnedScript, ProjectTask, RepositoryDetails, ScriptOutput, ScriptTerminal } from '../repositories'

interface UseTerminalsOptions {
  clearError: () => void
  selectedDetails: Ref<RepositoryDetails | null>
  showError: (error: unknown) => void
}

interface ScriptRunResult {
  exitCode?: number | null
  runId: string
  taskName: string
  signal?: string | null
}

export function useTerminals({
  clearError,
  selectedDetails,
  showError,
}: UseTerminalsOptions) {
  const selectedTerminalRunId = ref<string | null>(null)
  const scriptTerminals = ref<Record<string, ScriptTerminal>>({})
  const appOwnedRunIds = new Set<string>()
  const scriptRunWaiters = new Map<string, Array<(result: ScriptRunResult) => void>>()

  const hasRunningScripts = computed(() =>
    Object.values(scriptTerminals.value).some((terminal) => terminal.isRunning),
  )

  const activeTerminals = computed(() =>
    Object.values(scriptTerminals.value).sort((terminalA, terminalB) => {
      const repoComparison = terminalA.repoName.localeCompare(terminalB.repoName)

      if (repoComparison !== 0) {
        return repoComparison
      }

      return terminalA.taskName.localeCompare(terminalB.taskName)
    }),
  )

  const runningScriptsByRepositoryPath = computed(() => {
    const counts: Record<string, number> = {}

    for (const terminal of Object.values(scriptTerminals.value)) {
      if (!terminal.isRunning) {
        continue
      }

      counts[terminal.repoPath] = (counts[terminal.repoPath] ?? 0) + 1
    }

    return counts
  })

  const currentRepoScriptTerminals = computed(() => {
    if (!selectedDetails.value) {
      return {}
    }

    return Object.fromEntries(
      Object.values(scriptTerminals.value)
        .filter((terminal) => terminal.repoPath === selectedDetails.value?.path)
        .map((terminal) => [terminal.taskId, terminal]),
    )
  })

  const selectedTerminal = computed(() =>
    selectedTerminalRunId.value ? scriptTerminals.value[selectedTerminalRunId.value] : undefined,
  )

  function terminalForTask(repoPath: string, taskId: string) {
    return Object.values(scriptTerminals.value).find((terminal) =>
      terminal.repoPath === repoPath && terminal.taskId === taskId,
    )
  }

  function nodeTaskForScriptName(repository: Pick<RepositoryDetails, 'projectTasks'>, scriptName: string) {
    return repository.projectTasks.find((task) => task.id === `node:${scriptName}`) ??
      repository.projectTasks.find((task) => task.name === scriptName)
  }

  function handleScriptOutput(output: ScriptOutput) {
    const terminal = scriptTerminals.value[output.runId]

    if (!terminal) {
      return
    }

    if (output.done) {
      const exitLabel = output.signal
        ? `signal ${output.signal}`
        : `exit ${output.exitCode ?? 0}`
      const didSucceed = output.exitCode === 0
      const elapsedMs = Date.now() - terminal.startedAt
      const title = didSucceed
        ? `Task "${terminal.taskName}" finished`
        : output.signal
          ? `Task "${terminal.taskName}" stopped`
          : `Task "${terminal.taskName}" failed`

      if (!output.signal && (!didSucceed || elapsedMs >= 10_000)) {
        void window.desktop.notify({
          title,
          body: `${terminal.repoName} - ${exitLabel}`,
        })
      }
    }

    scriptTerminals.value[output.runId] = {
      ...terminal,
      output: `${terminal.output}${output.text}`,
      isRunning: output.done ? false : terminal.isRunning,
      exitCode: output.done ? output.exitCode ?? null : terminal.exitCode,
      signal: output.done ? output.signal ?? null : terminal.signal,
    }

    if (output.done) {
      appOwnedRunIds.delete(output.runId)
      resolveScriptRun(output.runId, {
        exitCode: output.exitCode,
        runId: output.runId,
        taskName: terminal.taskName,
        signal: output.signal,
      })
    }
  }

  function waitForScriptRun(terminal: ScriptTerminal) {
    return new Promise<ScriptRunResult>((resolve) => {
      const waiters = scriptRunWaiters.get(terminal.runId) ?? []
      waiters.push(resolve)
      scriptRunWaiters.set(terminal.runId, waiters)
    })
  }

  function resolveScriptRun(runId: string, result: ScriptRunResult) {
    const waiters = scriptRunWaiters.get(runId)

    if (!waiters) {
      return
    }

    scriptRunWaiters.delete(runId)

    for (const resolve of waiters) {
      resolve(result)
    }
  }

  function stopOwnedScripts() {
    if (appOwnedRunIds.size > 0) {
      window.repositories.stopScripts([...appOwnedRunIds])
    }

    appOwnedRunIds.clear()
    scriptTerminals.value = {}
  }

  async function startTerminal(
    repoPath: string,
    repoName: string,
    task: ProjectTask,
  ) {
    try {
      const scriptRun = await window.repositories.startScript({
        repoPath,
        taskId: task.id,
      })

      appOwnedRunIds.add(scriptRun.runId)
      scriptTerminals.value = {
        ...scriptTerminals.value,
        [scriptRun.runId]: {
          runId: scriptRun.runId,
          repoPath,
          repoName,
          taskId: task.id,
          taskName: task.name,
          source: task.source,
          command: scriptRun.command,
          output: `$ ${scriptRun.command}\n`,
          isRunning: true,
          startedAt: Date.now(),
          exitCode: null,
          signal: null,
        },
      }

      return scriptRun.runId
    } catch (error) {
      showError(error)
      return undefined
    }
  }

  async function runScript(taskId: string) {
    const task = selectedDetails.value?.projectTasks.find((entry) => entry.id === taskId)

    if (!selectedDetails.value || !task || terminalForTask(selectedDetails.value.path, task.id)) {
      return
    }

    clearError()
    await startTerminal(
      selectedDetails.value.path,
      selectedDetails.value.name,
      task,
    )
  }

  async function runRepositoryScript(script: PinnedScript) {
    const existingTerminal = terminalForTask(script.repoPath, script.taskId)

    if (existingTerminal) {
      selectedTerminalRunId.value = existingTerminal.runId
      return
    }

    clearError()
    await startTerminal(script.repoPath, script.repoName, {
      id: script.taskId,
      name: script.taskName,
      command: script.command,
      source: script.source,
      cwd: script.cwd,
    })
  }

  async function runRepositoryScriptsAndWait(
    repository: Pick<RepositoryDetails, 'name' | 'path' | 'projectTasks'>,
    scriptNames: string[],
  ) {
    const uniqueScriptNames = [...new Set(scriptNames)]
    const pendingResults: Array<Promise<ScriptRunResult>> = []

    for (const scriptName of uniqueScriptNames) {
      const task = nodeTaskForScriptName(repository, scriptName)

      if (!task) {
        throw new Error(`Could not find "${scriptName}".`)
      }

      const existingTerminal = terminalForTask(repository.path, task.id)

      if (existingTerminal?.isRunning) {
        pendingResults.push(waitForScriptRun(existingTerminal))
        continue
      }

      if (existingTerminal) {
        await stopTerminal(existingTerminal.runId)
      }

      const runId = await startTerminal(
        repository.path,
        repository.name,
        task,
      )

      if (!runId) {
        throw new Error(`Could not start "${scriptName}".`)
      }

      const terminal = scriptTerminals.value[runId]

      if (!terminal) {
        throw new Error(`Could not monitor "${scriptName}".`)
      }

      pendingResults.push(waitForScriptRun(terminal))
    }

    const results = await Promise.all(pendingResults)
    const failedResults = results.filter((result) => result.signal || result.exitCode !== 0)

    if (failedResults.length > 0) {
      throw new Error(
        `Health check failed: ${failedResults
          .map((result) =>
            result.signal
              ? `${result.taskName} stopped with ${result.signal}`
              : `${result.taskName} exited with code ${result.exitCode ?? 'unknown'}`,
          )
          .join(', ')}.`,
      )
    }

    return results
  }

  async function stopTerminal(runId: string) {
    const terminal = scriptTerminals.value[runId]

    if (!terminal) {
      return
    }

    if (terminal.isRunning) {
      await window.repositories.stopScript(terminal.runId)
    }

    appOwnedRunIds.delete(terminal.runId)
    const nextTerminals = { ...scriptTerminals.value }
    delete nextTerminals[terminal.runId]
    scriptTerminals.value = nextTerminals

    if (selectedTerminalRunId.value === terminal.runId) {
      selectedTerminalRunId.value = null
    }
  }

  async function stopScript(taskId: string) {
    const terminal = currentRepoScriptTerminals.value[taskId]

    if (!terminal) {
      return
    }

    await stopTerminal(terminal.runId)
  }

  async function restartTerminal(runId: string) {
    const terminal = scriptTerminals.value[runId]

    if (!terminal) {
      return
    }

    clearError()

    if (terminal.isRunning) {
      await window.repositories.stopScript(terminal.runId)
    }

    appOwnedRunIds.delete(terminal.runId)
    const nextTerminals = { ...scriptTerminals.value }
    delete nextTerminals[terminal.runId]
    scriptTerminals.value = nextTerminals

    const newRunId = await startTerminal(terminal.repoPath, terminal.repoName, {
      id: terminal.taskId,
      name: terminal.taskName,
      command: terminal.command,
      source: terminal.source,
    })

    if (newRunId && selectedTerminalRunId.value === runId) {
      selectedTerminalRunId.value = newRunId
    } else if (!newRunId && selectedTerminalRunId.value === runId) {
      selectedTerminalRunId.value = null
    }
  }

  async function restartScript(taskId: string) {
    const terminal = currentRepoScriptTerminals.value[taskId]

    if (!terminal) {
      await runScript(taskId)
      return
    }

    await restartTerminal(terminal.runId)
  }

  function openScriptTerminal(taskId: string) {
    const terminal = currentRepoScriptTerminals.value[taskId]

    if (terminal) {
      selectedTerminalRunId.value = terminal.runId
    }
  }

  function openTerminal(runId: string) {
    if (scriptTerminals.value[runId]) {
      selectedTerminalRunId.value = runId
    }
  }

  function closeTerminalModal() {
    selectedTerminalRunId.value = null
  }

  return {
    activeTerminals,
    closeTerminalModal,
    currentRepoScriptTerminals,
    handleScriptOutput,
    hasRunningScripts,
    openScriptTerminal,
    openTerminal,
    restartScript,
    restartTerminal,
    runRepositoryScript,
    runRepositoryScriptsAndWait,
    runningScriptsByRepositoryPath,
    runScript,
    selectedTerminal,
    stopOwnedScripts,
    stopScript,
    stopTerminal,
  }
}
