export const DEFAULT_VITE_DEV_PORT = 15185

export function resolveViteDevPort(value = process.env.VITE_DEV_PORT): number {
  if (value === undefined) return DEFAULT_VITE_DEV_PORT

  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new Error(`VITE_DEV_PORT must be an integer between 1 and 65535; received ${JSON.stringify(value)}`)
  }

  const port = Number(value)
  if (port > 65535) {
    throw new Error(`VITE_DEV_PORT must be an integer between 1 and 65535; received ${JSON.stringify(value)}`)
  }

  return port
}
