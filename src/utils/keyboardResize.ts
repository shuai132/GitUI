export function resizePercentageFromKey(
  current: number,
  key: string,
  min: number,
  max: number,
  step = 5,
): number | null {
  let next: number
  if (key === 'ArrowUp' || key === 'ArrowLeft') next = current - step
  else if (key === 'ArrowDown' || key === 'ArrowRight') next = current + step
  else if (key === 'Home') next = min
  else if (key === 'End') next = max
  else return null
  return Math.max(min, Math.min(max, next))
}
