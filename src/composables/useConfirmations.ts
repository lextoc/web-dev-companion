import { ref } from 'vue'

export interface ConfirmationDialog {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  resolve: (confirmed: boolean) => void
}

export function useConfirmations() {
  const confirmationDialog = ref<ConfirmationDialog | null>(null)

  function confirmAction(options: Omit<ConfirmationDialog, 'resolve'>) {
    return new Promise<boolean>((resolve) => {
      confirmationDialog.value = {
        ...options,
        resolve,
      }
    })
  }

  function closeConfirmation(confirmed: boolean) {
    const dialog = confirmationDialog.value

    if (!dialog) {
      return
    }

    confirmationDialog.value = null
    dialog.resolve(confirmed)
  }

  return {
    confirmationDialog,
    confirmAction,
    closeConfirmation,
  }
}
