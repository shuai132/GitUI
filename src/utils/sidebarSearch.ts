export function normalizeSidebarSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

export function matchesSidebarSearch(query: string, ...values: Array<string | undefined>): boolean {
  const normalizedQuery = normalizeSidebarSearchQuery(query)
  if (!normalizedQuery) return true
  return values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
}
