export type CommandPaletteIcon =
  | 'arrow-left'
  | 'command'
  | 'copy'
  | 'edit'
  | 'folder'
  | 'play'
  | 'repository'
  | 'restart'
  | 'terminal'

export interface CommandPaletteItem {
  id: string
  actionId?: string
  icon: CommandPaletteIcon
  title: string
  section: string
  subtitle?: string
  meta?: string
  keywords?: string[]
}
