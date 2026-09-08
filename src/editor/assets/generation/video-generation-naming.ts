import { generatedDisplayName } from './generation-naming'

export function generatedVideoDisplayName(input: {
  nodeName?: string
  existingName?: string
  newVideoName?: string
  fallback: string
}): string {
  return generatedDisplayName({
    preferredName: input.nodeName ?? input.existingName,
    newName: input.newVideoName,
    fallback: input.fallback,
  })
}
