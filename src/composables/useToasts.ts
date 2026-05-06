import { ref } from 'vue'

const MAX_ACTIVITY_ITEMS = 8
const MAX_TOAST_ITEMS = 4
const TOAST_DISMISS_MS = 4000

export type AppFeedbackTone = 'success' | 'info'

export interface AppToast {
  id: string
  message: string
  tone: AppFeedbackTone
}

export interface ActivityItem {
  id: string
  message: string
  time: string
  tone: AppFeedbackTone
}

export function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function useToasts() {
  const errorMessage = ref('')
  const appToasts = ref<AppToast[]>([])
  const activityItems = ref<ActivityItem[]>([])
  const toastTimers = new Map<string, number>()

  function toastId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  function clearToastTimer(id: string) {
    const timer = toastTimers.get(id)

    if (timer !== undefined) {
      window.clearTimeout(timer)
      toastTimers.delete(id)
    }
  }

  function dismissToast(id: string) {
    clearToastTimer(id)
    appToasts.value = appToasts.value.filter((toast) => toast.id !== id)
  }

  function holdToast(id: string) {
    clearToastTimer(id)
  }

  function releaseToast(id: string) {
    if (!appToasts.value.some((toast) => toast.id === id) || toastTimers.has(id)) {
      return
    }

    toastTimers.set(
      id,
      window.setTimeout(() => {
        dismissToast(id)
      }, TOAST_DISMISS_MS),
    )
  }

  function clearError() {
    errorMessage.value = ''
  }

  function showError(error: unknown) {
    errorMessage.value = normalizeError(error)
  }

  function recordActivity(message: string, tone: AppFeedbackTone = 'success') {
    activityItems.value = [
      {
        id: toastId(),
        message,
        tone,
        time: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
      ...activityItems.value,
    ].slice(0, MAX_ACTIVITY_ITEMS)
  }

  function showAppFeedback(message: string, tone: AppFeedbackTone = 'success') {
    const toast = {
      id: toastId(),
      message,
      tone,
    }
    const nextToasts = [toast, ...appToasts.value].slice(0, MAX_TOAST_ITEMS)

    for (const existingToast of appToasts.value) {
      if (!nextToasts.some((nextToast) => nextToast.id === existingToast.id)) {
        clearToastTimer(existingToast.id)
      }
    }

    appToasts.value = nextToasts
    recordActivity(message, tone)

    toastTimers.set(
      toast.id,
      window.setTimeout(() => {
        dismissToast(toast.id)
      }, TOAST_DISMISS_MS),
    )
  }

  function cleanupToasts() {
    for (const id of toastTimers.keys()) {
      clearToastTimer(id)
    }
  }

  return {
    activityItems,
    appToasts,
    clearError,
    cleanupToasts,
    dismissToast,
    errorMessage,
    holdToast,
    releaseToast,
    showAppFeedback,
    showError,
  }
}
