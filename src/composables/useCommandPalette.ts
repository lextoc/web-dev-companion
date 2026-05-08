import { computed, nextTick, ref, type Ref } from 'vue'
import type { CommandPaletteItem } from '../command-palette'
import { keybindingLabel } from '../keybindings'
import type { PinnedScript, RepositoryDetails, RepositorySummary, ScriptTerminal } from '../repositories'
import { SCRIPT_REFERENCE_SEPARATOR } from './usePersistedAppState'
import type { AppFeedbackTone } from './useToasts'

type ReadableRef<T> = {
  readonly value: T
}

type ScriptPaletteReference = {
  repoPath: string
  scriptName: string
}

interface UseCommandPaletteOptions {
  activeTerminals: ReadableRef<ScriptTerminal[]>
  chooseAndAddRepository: () => Promise<void>
  copyRepositoryPath: (repoPath: string) => Promise<void>
  hasRunningScripts: ReadableRef<boolean>
  isMacPlatform: Ref<boolean>
  isSettingsOpen: Ref<boolean>
  loadRepositories: () => Promise<void>
  openKeybindingsSheet: () => void
  openRepository: (repository: RepositorySummary) => Promise<void>
  openRepositoryInEditor: (repoPath: string) => Promise<void>
  openRepositoryInFileManager: (repoPath: string) => Promise<void>
  openRepositoryInTerminal: (repoPath: string) => Promise<void>
  openTerminal: (runId: string) => void
  pinnedScripts: Ref<PinnedScript[]>
  recentCommandIds: Ref<string[]>
  refreshSelectedRepository: () => Promise<void>
  rememberCommand: (commandId: string) => void
  repositories: Ref<RepositorySummary[]>
  runRepositoryScript: (script: PinnedScript) => Promise<void>
  runScript: (scriptName: string) => Promise<void>
  selectedDetails: Ref<RepositoryDetails | null>
  selectedPath: Ref<string | null>
  selectedSummary: ReadableRef<RepositorySummary | undefined>
  showAppFeedback: (message: string, tone?: AppFeedbackTone) => void
  stopOwnedScripts: () => void
}

export function useCommandPalette({
  activeTerminals,
  chooseAndAddRepository,
  copyRepositoryPath,
  hasRunningScripts,
  isMacPlatform,
  isSettingsOpen,
  loadRepositories,
  openKeybindingsSheet,
  openRepository,
  openRepositoryInEditor,
  openRepositoryInFileManager,
  openRepositoryInTerminal,
  openTerminal,
  pinnedScripts,
  recentCommandIds,
  refreshSelectedRepository,
  rememberCommand,
  repositories,
  runRepositoryScript,
  runScript,
  selectedDetails,
  selectedPath,
  selectedSummary,
  showAppFeedback,
  stopOwnedScripts,
}: UseCommandPaletteOptions) {
  const isCommandPaletteOpen = ref(false)

  const commandPaletteItems = computed(() => {
    const items = new Map<string, CommandPaletteItem>()
    const addItem = (item: CommandPaletteItem) => {
      items.set(item.id, item)
    }
    const currentRepoPath = activeRepositoryPath()
    const platform = isMacPlatform.value ? 'mac' : 'other'

    addItem({
      id: 'action:add-repository',
      icon: 'folder',
      title: 'Add repository',
      section: 'App',
      subtitle: 'Choose a repository folder to save',
      meta: keybindingLabel('add-repository', platform),
      keywords: ['browse', 'folder', 'new'],
    })
    addItem({
      id: 'action:refresh',
      icon: 'restart',
      title: selectedPath.value ? 'Refresh repository' : 'Refresh repositories',
      section: 'App',
      subtitle: selectedPath.value ? 'Reload current repository details' : 'Reload saved repositories',
      meta: keybindingLabel('refresh', platform),
      keywords: ['reload', 'sync'],
    })
    addItem({
      id: 'action:settings',
      icon: 'command',
      title: 'Open settings',
      section: 'App',
      meta: keybindingLabel('settings', platform),
      keywords: ['preferences'],
    })
    addItem({
      id: 'action:keybindings',
      icon: 'keyboard',
      title: 'Open keyboard shortcuts',
      section: 'App',
      meta: keybindingLabel('keyboard-shortcuts', platform),
      keywords: ['shortcuts', 'hotkeys', 'keybindings'],
    })

    if (currentRepoPath) {
      addItem({
        id: 'action:open-files',
        icon: 'folder',
        title: 'Open repository files',
        section: 'Repository',
        subtitle: currentRepoPath,
        meta: keybindingLabel('open-files', platform),
        keywords: ['finder', 'explorer', 'folder'],
      })
      addItem({
        id: 'action:open-editor',
        icon: 'edit',
        title: 'Open repository in editor',
        section: 'Repository',
        subtitle: currentRepoPath,
        meta: keybindingLabel('open-editor', platform),
        keywords: ['code', 'ide'],
      })
      addItem({
        id: 'action:open-terminal',
        icon: 'terminal',
        title: 'Open repository terminal',
        section: 'Repository',
        subtitle: currentRepoPath,
        meta: keybindingLabel('open-terminal', platform),
        keywords: ['shell', 'console'],
      })
      addItem({
        id: 'action:copy-path',
        icon: 'copy',
        title: 'Copy repository path',
        section: 'Repository',
        subtitle: currentRepoPath,
        keywords: ['clipboard'],
      })
    }

    if (hasRunningScripts.value) {
      addItem({
        id: 'action:stop-scripts',
        icon: 'terminal',
        title: 'Stop running scripts',
        section: 'Scripts',
        subtitle: `${activeTerminals.value.filter((terminal) => terminal.isRunning).length} running`,
        meta: keybindingLabel('stop-scripts', platform),
        keywords: ['cancel', 'abort'],
      })
    }

    for (const repository of repositories.value) {
      addItem({
        id: `repository:${repository.path}`,
        icon: 'repository',
        title: repository.name,
        section: 'Repositories',
        subtitle: repository.path,
        meta: repository.dirty ? 'Changes' : repository.branch,
        keywords: [repository.branch, repository.lastCommit, repository.remote ?? ''],
      })
    }

    if (selectedDetails.value) {
      for (const [scriptName, command] of Object.entries(selectedDetails.value.npmScripts)) {
        addItem({
          id: `script:${paletteScriptId(selectedDetails.value.path, scriptName)}`,
          icon: 'play',
          title: `Run ${scriptName}`,
          section: 'Current scripts',
          subtitle: command,
          meta: selectedDetails.value.packageManager ?? 'npm',
          keywords: [selectedDetails.value.name, selectedDetails.value.path],
        })
      }
    }

    for (const script of pinnedScripts.value) {
      addItem({
        id: `script:${paletteScriptId(script.repoPath, script.scriptName)}`,
        icon: 'play',
        title: `Run ${script.scriptName}`,
        section: 'Pinned scripts',
        subtitle: `${script.repoName} · ${script.command}`,
        meta: script.packageManager ?? 'npm',
        keywords: [script.repoName, script.repoPath],
      })
    }

    for (const terminal of activeTerminals.value) {
      addItem({
        id: `terminal:${terminal.runId}`,
        icon: 'terminal',
        title: `Open ${terminal.scriptName}`,
        section: 'Terminals',
        subtitle: terminal.repoName,
        meta: terminal.isRunning ? 'Running' : 'Finished',
        keywords: [terminal.command, terminal.repoPath],
      })
    }

    const baseItems = [...items.values()]
    const recentItems = recentCommandIds.value
      .map((commandId) => items.get(commandId))
      .filter((item): item is CommandPaletteItem => Boolean(item))
      .map((item) => ({
        ...item,
        id: `recent:${item.id}`,
        actionId: item.actionId ?? item.id,
        section: 'Recent',
        keywords: [...(item.keywords ?? []), 'recent'],
      }))

    return [...recentItems, ...baseItems]
  })

  function activeRepositoryPath() {
    return selectedDetails.value?.path ?? selectedSummary.value?.path
  }

  function openCommandPalette() {
    isCommandPaletteOpen.value = true
  }

  function closeCommandPalette() {
    isCommandPaletteOpen.value = false
  }

  async function runCommandPaletteItem(itemId: string) {
    closeCommandPalette()
    await nextTick()

    try {
      await runCommandPaletteAction(itemId)
    } finally {
      rememberCommand(itemId)
    }
  }

  async function runCommandPaletteAction(itemId: string) {
    if (itemId === 'action:add-repository') {
      await chooseAndAddRepository()
      return
    }

    if (itemId === 'action:refresh') {
      if (selectedPath.value) {
        await refreshSelectedRepository()
        return
      }

      await loadRepositories()
      return
    }

    if (itemId === 'action:settings') {
      isSettingsOpen.value = true
      return
    }

    if (itemId === 'action:keybindings') {
      openKeybindingsSheet()
      return
    }

    if (itemId === 'action:stop-scripts') {
      stopOwnedScripts()
      showAppFeedback('Stopped running scripts.', 'info')
      return
    }

    const repoPath = activeRepositoryPath()

    if (itemId === 'action:open-files' && repoPath) {
      await openRepositoryInFileManager(repoPath)
      return
    }

    if (itemId === 'action:open-editor' && repoPath) {
      await openRepositoryInEditor(repoPath)
      return
    }

    if (itemId === 'action:open-terminal' && repoPath) {
      await openRepositoryInTerminal(repoPath)
      return
    }

    if (itemId === 'action:copy-path' && repoPath) {
      await copyRepositoryPath(repoPath)
      return
    }

    if (itemId.startsWith('repository:')) {
      const selectedRepositoryPath = itemId.slice('repository:'.length)
      const repository = repositories.value.find((entry) => entry.path === selectedRepositoryPath)

      if (repository) {
        await openRepository(repository)
      }

      return
    }

    if (itemId.startsWith('script:')) {
      const script = parsePaletteScriptId(itemId.slice('script:'.length))

      if (!script) {
        return
      }

      const { repoPath: scriptRepoPath, scriptName } = script

      if (selectedDetails.value?.path === scriptRepoPath) {
        await runScript(scriptName)
        return
      }

      const pinnedScript = pinnedScripts.value.find((script) =>
        script.repoPath === scriptRepoPath && script.scriptName === scriptName,
      )

      if (pinnedScript) {
        await runRepositoryScript(pinnedScript)
      }

      return
    }

    if (itemId.startsWith('terminal:')) {
      openTerminal(itemId.slice('terminal:'.length))
    }
  }

  return {
    closeCommandPalette,
    commandPaletteItems,
    isCommandPaletteOpen,
    openCommandPalette,
    runCommandPaletteItem,
  }
}

function paletteScriptId(repoPath: string, scriptName: string) {
  return `${repoPath}${SCRIPT_REFERENCE_SEPARATOR}${scriptName}`
}

function parsePaletteScriptId(value: string): ScriptPaletteReference | null {
  const separatorIndex = value.lastIndexOf(SCRIPT_REFERENCE_SEPARATOR)
  if (separatorIndex < 0) {
    return null
  }

  return {
    repoPath: value.slice(0, separatorIndex),
    scriptName: value.slice(separatorIndex + 1),
  }
}
