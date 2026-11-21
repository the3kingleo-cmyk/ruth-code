# Bundled browse binary

Ruth ships the official `browse` CLI so it can drive the user's Chrome-family
browser through the browse extension and MCP server (`browse mcp`).

This tree vendors the linux-x64 0.1.5 binary extracted from the checksum-verified
package `opencode-browse-linux-x64-0.1.5.tgz` (sha256
`8ba73f16322a42544cad3a97490bfd14957b97b108b58f43913e6ca088a3cdd7`).

The offline installer copies `linux-x64/browse` into `bin/browse` next to `ruth`.
Ruth registers it as a local MCP server. Auto-update is turned off
(`OPENCODE_BROWSER_AUTO_UPDATE=off`). Do not pass `--remote` (that would expose
the relay on the network).

The Chrome extension still comes from the Chrome Web Store (id
`mfnicocicmmlkpjnaffgihfjhdgjkdjg`); pair it with `browse pair` or `browse install`
on the user's machine if it is not connected yet.
