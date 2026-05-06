import { computed, ref, type Ref } from 'vue'
import type { PinnedScript, RepositoryDetails, ScriptOutput, ScriptTerminal } from '../repositories'

interface UseTerminalsOptions {
  clearError: () => void
  selectedDetails: Ref<RepositoryDetails | null>
  showError: (error: unknown) => void
}

export function useTerminals({
  clearError,
  selectedDetails,
  showError,
}: UseTerminalsOptions) {
  const selectedTerminalRunId = ref<string | null>(null)
  const scriptTerminals = ref<Record<string, ScriptTerminal>>({})
  const appOwnedRunIds = new Set<string>()

  const hasRunningScripts = computed(() =>
    Object.values(scriptTerminals.value).some((terminal) => terminal.isRunning),
  )

  const activeTerminals = computed(() =>
    Object.values(scriptTerminals.value).sort((terminalA, terminalB) => {
      const repoComparison = terminalA.repoName.localeCompare(terminalB.repoName)

      if (repoComparison !== 0) {
        return repoComparison
      }

      return terminalA.scriptName.localeCompare(terminalB.scriptName)
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
        .map((terminal) => [terminal.scriptName, terminal]),
    )
  })

  const selectedTerminal = computed(() =>
    selectedTerminalRunId.value ? scriptTerminals.value[selectedTerminalRunId.value] : undefined,
  )

  function terminalForScript(repoPath: string, scriptName: string) {
    return Object.values(scriptTerminals.value).find((terminal) =>
      terminal.repoPath === repoPath && terminal.scriptName === scriptName,
    )
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
        ? `Script "${terminal.scriptName}" finished`
        : output.signal
          ? `Script "${terminal.scriptName}" stopped`
          : `Script "${terminal.scriptName}" failed`

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
    }

    if (output.done) {
      appOwnedRunIds.delete(output.runId)
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
    scriptName: string,
    packageManager?: string,
  ) {
    try {
      const scriptRun = await window.repositories.startScript({
        repoPath,
        scriptName,
        packageManager,
      })

      appOwnedRunIds.add(scriptRun.runId)
      scriptTerminals.value = {
        ...scriptTerminals.value,
        [scriptRun.runId]: {
          runId: scriptRun.runId,
          repoPath,
          repoName,
          scriptName,
          command: scriptRun.command,
          output: `$ ${scriptRun.command}\n`,
          isRunning: true,
          startedAt: Date.now(),
        },
      }

      return scriptRun.runId
    } catch (error) {
      showError(error)
      return undefined
    }
  }

  async function runScript(scriptName: string) {
    if (!selectedDetails.value || terminalForScript(selectedDetails.value.path, scriptName)) {
      return
    }

    clearError()
    await startTerminal(
      selectedDetails.value.path,
      selectedDetails.value.name,
      scriptName,
      selectedDetails.value.packageManager,
    )
  }

  async function runRepositoryScript(script: PinnedScript) {
    const existingTerminal = terminalForScript(script.repoPath, script.scriptName)

    if (existingTerminal) {
      selectedTerminalRunId.value = existingTerminal.runId
      return
    }

    clearError()
    await startTerminal(script.repoPath, script.repoName, script.scriptName, script.packageManager)
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

  async function stopScript(scriptName: string) {
    const terminal = currentRepoScriptTerminals.value[scriptName]

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

    const newRunId = await startTerminal(terminal.repoPath, terminal.repoName, terminal.scriptName)

    if (newRunId && selectedTerminalRunId.value === runId) {
      selectedTerminalRunId.value = newRunId
    } else if (!newRunId && selectedTerminalRunId.value === runId) {
      selectedTerminalRunId.value = null
    }
  }

  async function restartScript(scriptName: string) {
    const terminal = currentRepoScriptTerminals.value[scriptName]

    if (!terminal) {
      await runScript(scriptName)
      return
    }

    await restartTerminal(terminal.runId)
  }

  function openScriptTerminal(scriptName: string) {
    const terminal = currentRepoScriptTerminals.value[scriptName]

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
    runningScriptsByRepositoryPath,
    runScript,
    selectedTerminal,
    stopOwnedScripts,
    stopScript,
    stopTerminal,
  }
}
