export interface SlashCommandSearchItem {
  title: string
  keywords: string[]
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function subsequenceScore(query: string, candidate: string): number | null {
  let queryIndex = 0
  let firstMatch = -1
  let lastMatch = -1

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    if (candidate[candidateIndex] !== query[queryIndex]) {
      continue
    }

    if (firstMatch === -1) {
      firstMatch = candidateIndex
    }
    lastMatch = candidateIndex
    queryIndex += 1

    if (queryIndex === query.length) {
      const span = lastMatch - firstMatch + 1
      return firstMatch + (span - query.length)
    }
  }

  return null
}

function scoreTerm(query: string, candidate: string, isTitle: boolean): number | null {
  if (candidate === query) {
    return isTitle ? 0 : 1
  }

  if (candidate.startsWith(query)) {
    return (isTitle ? 10 : 12) + candidate.length - query.length
  }

  const substringIndex = candidate.indexOf(query)
  if (substringIndex !== -1) {
    return (isTitle ? 30 : 32) + substringIndex
  }

  // One-character fuzzy searches make the menu feel random. Prefix and
  // substring matching above are still available for short queries.
  if (query.length < 2) {
    return null
  }

  const fuzzyScore = subsequenceScore(query, candidate)
  return fuzzyScore === null ? null : (isTitle ? 50 : 52) + fuzzyScore
}

export function filterSlashCommands<T extends SlashCommandSearchItem>(
  commands: T[],
  query: string | null,
): T[] {
  if (query === null || query.length === 0) {
    return commands
  }

  const compactQuery = compact(query)
  if (!compactQuery) {
    return []
  }

  return commands
    .map((command, index) => {
      const terms = [command.title, ...command.keywords]
      let bestScore: number | null = null

      terms.forEach((term, termIndex) => {
        const score = scoreTerm(compactQuery, compact(term), termIndex === 0)
        if (score !== null && (bestScore === null || score < bestScore)) {
          bestScore = score
        }
      })

      return { command, index, score: bestScore }
    })
    .filter((result): result is typeof result & { score: number } => result.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ command }) => command)
}
