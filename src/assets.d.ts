declare module '*.woff2' {
  const url: string
  export default url
}

declare module '*.woff2?url' {
  const url: string
  export default url
}

declare module '*.js?url' {
  const url: string
  export default url
}
