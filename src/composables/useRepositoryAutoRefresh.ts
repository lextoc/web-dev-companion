import { computed, ref, type Ref } from 'vue'
import type { AppSettings } from '../settings'

const FOCUS_REFRESH_THROTTLE_MS = 2000
const AUTO_REFRESH_TICK_MS = 1000

type ReadableRef<T> = {
  readonly value: T
}

interface UseRepositoryAutoRefreshOptions {
  appSettings: Ref<AppSettings>
  deletingBranchName: ReadableRef<string | null>
  deletingSubmoduleBranchName: ReadableRef<string | null>
  checkingOutSubmoduleBranchName: ReadableRef<string | null>
  hasCommitDraft: ReadableRef<boolean>
  hasRunningScripts: ReadableRef<boolean>
  isDetailLoading: ReadableRef<boolean>
  isLoading: ReadableRef<boolean>
  loadRepositories: () => Promise<void>
  mergingBranchName: ReadableRef<string | null>
  mergingLinkedBranchName: ReadableRef<string | null>
  pendingStatusActionKey: ReadableRef<string | null>
  refreshSelectedRepository: () => Promise<void>
  selectedPath: Ref<string | null>
  syncingBranchName: ReadableRef<string | null>
  syncingSubmoduleBranchName: ReadableRef<string | null>
}

export function useRepositoryAutoRefresh({
  appSettings,
  deletingBranchName,
  deletingSubmoduleBranchName,
  checkingOutSubmoduleBranchName,
  hasCommitDraft,
  hasRunningScripts,
  isDetailLoading,
  isLoading,
  loadRepositories,
  mergingBranchName,
  mergingLinkedBranchName,
  pendingStatusActionKey,
  refreshSelectedRepository,
  selectedPath,
  syncingBranchName,
  syncingSubmoduleBranchName,
}: UseRepositoryAutoRefreshOptions) {
  const autoRefreshRemainingMs = ref(appSettings.value.autoRefreshIntervalMs)
  let autoRefreshTickTimer: number | undefined
  let nextAutoRefreshAt = 0
  let lastFocusRefreshAt = 0

  const autoRefreshProgress = computed(() =>
    Math.max(0, Math.min(100, (autoRefreshRemainingMs.value / appSettings.value.autoRefreshIntervalMs) * 100)),
  )

  const autoRefreshLabel = computed(() => {
    const totalSeconds = Math.ceil(autoRefreshRemainingMs.value / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    return `${minutes}:${seconds.toString().padStart(2, '0')} until auto refresh`
  })

  async function refreshOnWindowFocus() {
    const now = Date.now()

    if (now - lastFocusRefreshAt < FOCUS_REFRESH_THROTTLE_MS) {
      return
    }

    if (
      isLoading.value ||
      isDetailLoading.value ||
      pendingStatusActionKey.value ||
      syncingBranchName.value ||
      syncingSubmoduleBranchName.value ||
      checkingOutSubmoduleBranchName.value ||
      deletingBranchName.value ||
      deletingSubmoduleBranchName.value ||
      mergingBranchName.value ||
      mergingLinkedBranchName.value ||
      hasRunningScripts.value ||
      hasCommitDraft.value
    ) {
      return
    }

    lastFocusRefreshAt = now

    if (selectedPath.value) {
      await refreshSelectedRepository()
      return
    }

    await loadRepositories()
  }

  function updateAutoRefreshCountdown() {
    if (!selectedPath.value) {
      stopAutoRefreshTimer()
      return
    }

    const remainingMs = nextAutoRefreshAt - Date.now()
    autoRefreshRemainingMs.value = Math.max(0, remainingMs)

    if (remainingMs > 0 || isDetailLoading.value) {
      return
    }

    if (
      hasRunningScripts.value ||
      hasCommitDraft.value ||
      syncingSubmoduleBranchName.value ||
      checkingOutSubmoduleBranchName.value ||
      deletingSubmoduleBranchName.value ||
      mergingBranchName.value ||
      mergingLinkedBranchName.value
    ) {
      resetAutoRefreshTimer()
      return
    }

    void refreshSelectedRepository()
  }

  function resetAutoRefreshTimer() {
    nextAutoRefreshAt = Date.now() + appSettings.value.autoRefreshIntervalMs
    autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs

    if (autoRefreshTickTimer === undefined) {
      autoRefreshTickTimer = window.setInterval(updateAutoRefreshCountdown, AUTO_REFRESH_TICK_MS)
    }
  }

  function stopAutoRefreshTimer() {
    if (autoRefreshTickTimer !== undefined) {
      window.clearInterval(autoRefreshTickTimer)
      autoRefreshTickTimer = undefined
    }

    nextAutoRefreshAt = 0
    autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
  }

  function syncAutoRefreshInterval() {
    autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
  }

  return {
    autoRefreshLabel,
    autoRefreshProgress,
    autoRefreshRemainingMs,
    refreshOnWindowFocus,
    resetAutoRefreshTimer,
    stopAutoRefreshTimer,
    syncAutoRefreshInterval,
  }
}
