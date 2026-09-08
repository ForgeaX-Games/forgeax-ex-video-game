export function generatedDisplayName(input: {
  preferredName?: string
  newName?: string
  prompt?: string
  fallback: string
}): string {
  const preferredName = input.preferredName?.trim()
  if (preferredName) return preferredName
  const newName = input.newName?.trim()
  if (newName) return newName
  const prompt = input.prompt?.trim()
  return prompt ? prompt.slice(0, 48) : input.fallback
}

export function nextGeneratedName(
  existingNames: readonly string[],
  formatName: (number: number) => string,
): string {
  const names = new Set(existingNames.map((name) => name.trim()))
  let number = 1
  while (names.has(formatName(number))) number += 1
  return formatName(number)
}
