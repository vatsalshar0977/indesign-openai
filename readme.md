# InDesign ⇄ Arena

This fork of [openai-4-indesign](https://github.com/RolandDreger/indesign-openai) connects
Adobe InDesign to an **agent** instead of OpenAI. Two pieces:

- **`arena-link/` — Arena Link**, a UXP plugin of our own: no API key, no model picker, no
  account. It sends requests to the bridge and lets the agent read and edit the open document
  (selection, frames, find/replace, alt text, export).
- **`bridge/`** — a zero-dependency Node server: queues each request as a job until the agent
  answers it, and carries agent commands the other way into InDesign.

```bash
npm run bridge         # start the bridge, open the dashboard it prints
npm run build:arena    # build Plugin/ArenaLink.ccx with the bridge address baked in
npm test               # round-trip tests with mocked UXP + InDesign
```

**Start here:** [docs/ARENA-LINK.md](docs/ARENA-LINK.md) (the plugin) ·
[docs/BRIDGE.md](docs/BRIDGE.md) (server, CLI, API) ·
[docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md) (installation) ·
[docs/INSTALL.md](docs/INSTALL.md) (all platforms, local bridge).

## Quick start

1. `npm run bridge` → note the URL it prints.
2. Install `Plugin/ArenaLink.ccx` (or load `arena-link/` with the UXP Developer Tool).
3. In the panel: paste the URL, press **Connect**, leave *Let the agent drive InDesign* on.
4. Type an instruction and press **Send** — or just ask the agent, which can now work on the
   document directly.

The original `OpenAI-4-InDesign` panel is not used by any of this. Its source is kept in
`src/` (with an agent mode added earlier) so the upstream project stays intact — see
[docs/BRIDGE.md §5](docs/BRIDGE.md) if you ever want the OpenAI path back.

## Repository map

| path | what |
| --- | --- |
| `arena-link/` | Arena Link UXP plugin (the one to install) |
| `bridge/server.mjs` | bridge server: job queue + command channel |
| `bridge/cli.mjs` | agent CLI (`jobs`, `read`, `write`, `cmd`, `complete`, …) |
| `bridge/public/index.html` | browser dashboard |
| `standalone/indesign-bridge.mjs` | single-file bridge for your own machine |
| `src/` | upstream OpenAI panel (legacy; agent mode optional) |
| `scripts/` | builds, icon generator, manifest helper |
| `test/` | mocked-UXP round-trip tests for both plugins |

## License

MIT — see [LICENSE](LICENSE). Upstream panel by Roland Dreger.
