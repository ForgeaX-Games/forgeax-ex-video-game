import { createExtensionClient } from '@forgeax/extension-host/extension'

export type ExtensionHostClient = ReturnType<typeof createExtensionClient>

let client: ExtensionHostClient | undefined
let injected: ExtensionHostClient | undefined

/**
 * The extension client every consumer shares.
 *
 * In an iframe there is no client until one is built here, and building it
 * starts the parent handshake. An in-process host has no parent to shake hands
 * with, so it injects an already-connected client instead.
 */
export function getExtensionHost(): ExtensionHostClient {
  if (injected) return injected
  return client ??= createExtensionClient()
}

/** Installs the host-supplied client used by in-process (non-iframe) mounts. */
export function setExtensionHost(next: ExtensionHostClient): void {
  injected = next
}

export function clearExtensionHost(): void {
  injected = undefined
}

export class ExtensionResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ExtensionResponseError'
  }
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'))
}

/** Parses only successful, explicitly JSON extension-router responses. */
export async function readExtensionJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new ExtensionResponseError(response.status, `Extension request failed (${response.status})`)
  }
  if (!isJsonContentType(response.headers.get('content-type'))) {
    throw new ExtensionResponseError(response.status, 'Extension returned a non-JSON response')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ExtensionResponseError(response.status, 'Extension returned malformed JSON')
  }
  return body
}
