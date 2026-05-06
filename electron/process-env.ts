import os from 'node:os'
import path from 'node:path'

export function childProcessEnv() {
  const homeDirectory = os.homedir()
  const pathEntries = [
    process.env.PATH,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.cargo', 'bin'),
    path.join(homeDirectory, '.volta', 'bin'),
    path.join(homeDirectory, '.asdf', 'shims'),
  ].filter((entry): entry is string => Boolean(entry))

  return {
    ...process.env,
    PATH: [...new Set(pathEntries.flatMap((entry) => entry.split(path.delimiter).filter(Boolean)))].join(
      path.delimiter,
    ),
  }
}
