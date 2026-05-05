export interface OutputSegment {
  key: string
  text: string
  className: string
}

export interface DiffLine {
  key: string
  prefix: string
  content: string
  className: string
}

const sgrPattern = /(?:\x1b\[|\[)([0-9;]*)m/g
const ansiControlPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g
const foregroundClasses: Record<number, string> = {
  30: 'ansi-fg-black',
  31: 'ansi-fg-red',
  32: 'ansi-fg-green',
  33: 'ansi-fg-yellow',
  34: 'ansi-fg-blue',
  35: 'ansi-fg-magenta',
  36: 'ansi-fg-cyan',
  37: 'ansi-fg-white',
  90: 'ansi-fg-bright-black',
  91: 'ansi-fg-bright-red',
  92: 'ansi-fg-bright-green',
  93: 'ansi-fg-bright-yellow',
  94: 'ansi-fg-bright-blue',
  95: 'ansi-fg-bright-magenta',
  96: 'ansi-fg-bright-cyan',
  97: 'ansi-fg-bright-white',
}

function classNameFromState(state: Set<string>) {
  return [...state].sort().join(' ')
}

function applySgrCodes(state: Set<string>, rawCodes: string) {
  const codes = rawCodes
    ? rawCodes.split(';').map((code) => Number(code || 0))
    : [0]

  for (const code of codes) {
    if (code === 0) {
      state.clear()
      continue
    }

    if (code === 1) {
      state.add('ansi-bold')
      continue
    }

    if (code === 2) {
      state.add('ansi-dim')
      continue
    }

    if (code === 22) {
      state.delete('ansi-bold')
      state.delete('ansi-dim')
      continue
    }

    if (code === 39) {
      for (const className of Object.values(foregroundClasses)) {
        state.delete(className)
      }
      continue
    }

    const foregroundClass = foregroundClasses[code]

    if (foregroundClass) {
      for (const className of Object.values(foregroundClasses)) {
        state.delete(className)
      }

      state.add(foregroundClass)
    }
  }
}

export function parseAnsiOutput(output: string): OutputSegment[] {
  const cleanOutput = output.replace(ansiControlPattern, '')
  const segments: OutputSegment[] = []
  const state = new Set<string>()
  let lastIndex = 0
  let segmentIndex = 0

  for (const match of cleanOutput.matchAll(sgrPattern)) {
    const index = match.index ?? 0

    if (index > lastIndex) {
      segments.push({
        key: `${segmentIndex}`,
        text: cleanOutput.slice(lastIndex, index),
        className: classNameFromState(state),
      })
      segmentIndex += 1
    }

    applySgrCodes(state, match[1] ?? '')
    lastIndex = index + match[0].length
  }

  if (lastIndex < cleanOutput.length) {
    segments.push({
      key: `${segmentIndex}`,
      text: cleanOutput.slice(lastIndex),
      className: classNameFromState(state),
    })
  }

  return segments.length ? segments : [{ key: '0', text: cleanOutput, className: '' }]
}

export function plainTerminalText(output: string) {
  return parseAnsiOutput(output).map((segment) => segment.text).join('')
}

export function parseDiffOutput(output: string): DiffLine[] {
  return output.split('\n').map((line, index) => {
    let className = 'diff-line-context'
    let prefix = ' '
    let content = line

    if (line.startsWith('+++') || line.startsWith('---')) {
      className = 'diff-line-file'
    } else if (line.startsWith('@@')) {
      className = 'diff-line-hunk'
    } else if (line.startsWith('+')) {
      className = 'diff-line-added'
    } else if (line.startsWith('-')) {
      className = 'diff-line-removed'
    }

    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('@')) {
      prefix = line[0] ?? ' '
      content = line.slice(1)
    }

    return {
      key: `${index}-${line}`,
      prefix,
      content,
      className,
    }
  })
}
