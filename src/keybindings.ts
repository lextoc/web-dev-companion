export type KeybindingPlatform = 'mac' | 'other'

export interface KeybindingDefinition {
  id: string
  section: string
  title: string
  scope: string
  keys: Record<KeybindingPlatform, string[]>
}

export const KEYBINDINGS: KeybindingDefinition[] = [
  {
    id: 'command-palette',
    section: 'App',
    title: 'Open command palette',
    scope: 'Anywhere',
    keys: {
      mac: ['⌘K', '/'],
      other: ['Ctrl K', '/'],
    },
  },
  {
    id: 'keyboard-shortcuts',
    section: 'App',
    title: 'Open keyboard shortcuts',
    scope: 'Anywhere',
    keys: {
      mac: ['⌘/'],
      other: ['Ctrl /'],
    },
  },
  {
    id: 'add-repository',
    section: 'App',
    title: 'Add repository',
    scope: 'Anywhere',
    keys: {
      mac: ['⌘O'],
      other: ['Ctrl O'],
    },
  },
  {
    id: 'settings',
    section: 'App',
    title: 'Open settings',
    scope: 'Anywhere',
    keys: {
      mac: ['⌘,'],
      other: ['Ctrl ,'],
    },
  },
  {
    id: 'dashboard',
    section: 'Navigation',
    title: 'Return to dashboard',
    scope: 'Repository open',
    keys: {
      mac: ['⌘1'],
      other: ['Ctrl 1'],
    },
  },
  {
    id: 'refresh',
    section: 'Navigation',
    title: 'Refresh current view',
    scope: 'Anywhere',
    keys: {
      mac: ['⌘R'],
      other: ['Ctrl R'],
    },
  },
  {
    id: 'open-editor',
    section: 'Repository',
    title: 'Open repository in editor',
    scope: 'Repository selected',
    keys: {
      mac: ['⌘E'],
      other: ['Ctrl E'],
    },
  },
  {
    id: 'open-files',
    section: 'Repository',
    title: 'Open repository files',
    scope: 'Repository selected',
    keys: {
      mac: ['⌘⇧F'],
      other: ['Ctrl Shift F'],
    },
  },
  {
    id: 'open-terminal',
    section: 'Repository',
    title: 'Open repository terminal',
    scope: 'Repository selected',
    keys: {
      mac: ['⌘`'],
      other: ['Ctrl `'],
    },
  },
  {
    id: 'branch-switcher',
    section: 'Git',
    title: 'Open branch switcher',
    scope: 'Repository open',
    keys: {
      mac: ['⌘B'],
      other: ['Ctrl B'],
    },
  },
  {
    id: 'sync-branch',
    section: 'Git',
    title: 'Sync current branch',
    scope: 'Repository open',
    keys: {
      mac: ['⌘S'],
      other: ['Ctrl S'],
    },
  },
  {
    id: 'stage-all',
    section: 'Git',
    title: 'Stage all changes',
    scope: 'Repository open',
    keys: {
      mac: ['⌘A'],
      other: ['Ctrl A'],
    },
  },
  {
    id: 'unstage-all',
    section: 'Git',
    title: 'Unstage all staged files',
    scope: 'Repository open',
    keys: {
      mac: ['⌘⇧A'],
      other: ['Ctrl Shift A'],
    },
  },
  {
    id: 'commit',
    section: 'Git',
    title: 'Commit staged changes',
    scope: 'Commit message focused',
    keys: {
      mac: ['⌘↵'],
      other: ['Ctrl ↵'],
    },
  },
  {
    id: 'stop-scripts',
    section: 'Scripts',
    title: 'Stop running scripts',
    scope: 'Scripts running',
    keys: {
      mac: ['⌘⇧S'],
      other: ['Ctrl Shift S'],
    },
  },
  {
    id: 'close-overlay',
    section: 'Overlays',
    title: 'Close active overlay',
    scope: 'Overlay open',
    keys: {
      mac: ['Esc'],
      other: ['Esc'],
    },
  },
]

export function keybindingKeys(id: string, platform: KeybindingPlatform) {
  return KEYBINDINGS.find((keybinding) => keybinding.id === id)?.keys[platform] ?? []
}

export function keybindingLabel(id: string, platform: KeybindingPlatform) {
  return keybindingKeys(id, platform)[0] ?? ''
}
