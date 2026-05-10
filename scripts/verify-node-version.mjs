const minimum = [20, 19, 4]
const maximumMajor = 21
const current = process.versions.node.split('.').map((part) => Number(part))

const compareVersions = (left, right) => {
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }

  return 0
}

const isBeforeMinimum = compareVersions(current, minimum) < 0

const isAtOrAfterMaximum = current[0] >= maximumMajor

if (isBeforeMinimum || isAtOrAfterMaximum) {
  console.error(
    [
      `Unsupported Node.js version: ${process.versions.node}.`,
      'Web Dev Companion requires Node.js >=20.19.4 <21.',
      'Run `nvm install 20.19.4` once if needed, then `nvm use` from the repository root.',
    ].join('\n'),
  )
  process.exit(1)
}
