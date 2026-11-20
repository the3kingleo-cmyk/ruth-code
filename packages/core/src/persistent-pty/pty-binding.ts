// Release builds replace this module with the embedded ruth-pty binary when one is bundled for the target.
const binding: string | { readonly path: string; readonly version: string; readonly sha256: string } | undefined =
  undefined

export default binding
