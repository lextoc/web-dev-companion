import { ref } from 'vue'

const MAX_ACTIVITY_ITEMS = 8

export interface AppFeedback {
  message: string
  tone: 'success' | 'info'
}

export interface ActivityItem {
  id: string
  message: string
  time: string
  tone: AppFeedback['tone']
}

export function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function useToasts() {
  const errorMessage = ref('')
  const appFeedback = ref<AppFeedback | null>(null)
  const activityItems = ref<ActivityItem[]>([])
  let appFeedbackTimer: number | undefined

  function clearError() {
    errorMessage.value = ''
  }

  function showError(error: unknown) {
    errorMessage.value = normalizeError(error)
  }

  function recordActivity(message: string, tone: AppFeedback['tone'] = 'success') {
    activityItems.value = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  function showAppFeedback(message: string, tone: AppFeedback['tone'] = 'success') {
    appFeedback.value = { message, tone }
    recordActivity(message, tone)

    if (appFeedbackTimer !== undefined) {
      window.clearTimeout(appFeedbackTimer)
    }

    appFeedbackTimer = window.setTimeout(() => {
      appFeedback.value = null
      appFeedbackTimer = undefined
    }, 4000)
  }

  function cleanupToasts() {
    if (appFeedbackTimer !== undefined) {
      window.clearTimeout(appFeedbackTimer)
      appFeedbackTimer = undefined
    }
  }

  return {
    activityItems,
    appFeedback,
    clearError,
    cleanupToasts,
    errorMessage,
    showAppFeedback,
    showError,
  }
}
