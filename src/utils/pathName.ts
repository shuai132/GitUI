export function isInvalidDirectoryLeafName(rawName: string): boolean {
  const name = rawName.trim()
  return name === '.' || name === '..' || /[\\/]/.test(name)
}
