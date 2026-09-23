# Arena bridge — InDesign driven by an agent, no ChatGPT involved

The bridge is a small zero-dependency Node server between InDesign and the agent.
There is **no OpenAI account, no API key and no model selection** anywhere in the default
flow: the panel sends the request here, the agent answers it.

Two directions, one link:

1. **Ask the agent** — type an instruction in the panel, press **Send**. The request becomes
   a job here; the agent reads it, writes the answer, and it appears in the panel.
2. **Agent drives InDesign** — the agent sends commands the other way: read the selection,
   rewrite it, inspect the document, list frames, export a PDF.

```
panel  ──POST /v1/chat/completions──▶  bridge  ──job──▶  agent
       ◀──202 + poll /v1/jobs/:id───          ◀──answer──

agent ──POST /v1/indesign/commands──▶ queue ──long poll──▶ panel ──result──▶ agent
```

## 1 · Start the bridge

```bash
npm run bridge                 # or: PORT=8787 BRIDGE_TOKEN=secret node bridge/server.mjs
```

| env var | default | purpose |
| --- | --- | --- |
| `PORT` | `8787` | port to listen on (bound to `0.0.0.0`) |
| `BRIDGE_TOKEN` | *(none)* | required on the agent endpoints when set |
| `PUBLIC_URL` | `http://localhost:PORT` | the URL the plugin should use (printed on start) |
| `BRIDGE_DATA_DIR` | `bridge/.data` | jobs, commands and uploaded images |

Open `http://localhost:8787/` (or the public URL) for the dashboard: connection status,
queued requests, command results, and the address to paste into the plugin.

## 2 · Point the plugin at the bridge

**Packaged plugin (`.ccx`)** — bake the address in at build time:

```bash
BRIDGE_URL=https://8787-xxxxx.e2b.app npm run build     # -> Plugin/openai-4-indesign.ccx
```

That writes the URL into `lib/config.js` and adds its origin to
`manifest.json > requiredPermissions.network.domains`, which UXP requires before the panel
may talk to a host. Install the `.ccx` by double-clicking it (unsigned plugins need
InDesign's player debug mode enabled).

**From source with the UXP Developer Tool**:

```bash
node scripts/set-url.mjs https://8787-xxxxx.e2b.app     # adds the origin to src/manifest.json
```

**At runtime** — click the **link icon** in the panel and paste the bridge URL. Whatever is
entered there wins over the baked-in value.

> The manifest allows `https://*.e2b.app`, so a new sandbox host works without rebuilding.
> For a completely different host, rebuild (or re-run `set-url.mjs`) — UXP whitelists network
> domains in the manifest and blocks anything not listed.

## 3 · Using it in InDesign

The panel starts in **agent mode**:

- the mode dropdown offers *Arena agent* and *Arena agent · image description*;
- the API key field and the model settings (number of choices, creativity) are hidden —
  nothing to fill in, nothing to sign up for;
- the **agent link** is on by default, so the agent can also work on the document directly.

Type an instruction (optionally import the selected text with the arrow button) and press
**Send**. The panel shows *“Waiting for the agent …”*, the request appears in the dashboard
queue, and the answer lands in the panel as soon as the agent replies — the spinner polls
every ~20 s, so there is no timeout to worry about. Press **Insert** to place it in the
document, as before.

For the image description mode, select an image and send: the panel exports the selection
and uploads it with the request; the bridge saves it to `bridge/.data/media/` so the agent
can actually look at it.

## 4 · The agent's side

```bash
node bridge/cli.mjs status                     # bridge + InDesign up?
node bridge/cli.mjs jobs                       # what is waiting?
node bridge/cli.mjs job job_ab12cd34           # read the request
node bridge/cli.mjs complete job_ab12cd34 --file reply.txt   # answer (or --text / --stdin)
node bridge/cli.mjs media job_ab12cd34         # paths of uploaded images

node bridge/cli.mjs read                       # text of the current selection
node bridge/cli.mjs frames                     # text frames of the active spread
node bridge/cli.mjs info                       # active document
node bridge/cli.mjs write --file new-text.txt  # replace the selection
node bridge/cli.mjs cmd frame.set --args '{"index":0,"text":"Hi"}'
node bridge/cli.mjs cmds                       # command history + results
```

| command | args | returns |
| --- | --- | --- |
| `ping` | – | app name, version, open document count |
| `app.info` | – | open documents, active document, selection kinds |
| `doc.info` | – | name, path, pages, spreads, page size, units, link count |
| `doc.list` | – | all open documents |
| `selection.get` | `limit`, `maxChars`, `columnSeparator`, `rowSeparator` | text (or table) of the selection |
| `selection.set` | `text`, separators | writes the selection, tables cell by cell |
| `frames.list` | `limit`, `maxChars`, `scope: "page"` | text frames of the active spread/page with contents |
| `frame.set` | `index` \| `name` \| `label`, `text` | overwrites one frame |
| `text.append` | `text`, `storyIndex` | appends to the end of a story |
| `styles.list` | – | paragraph and character style names |
| `links.list` | `limit` | linked images and their status |
| `doc.export` | `format: pdf \| idml \| jpeg \| png \| eps` | exports into the plugin temp folder, returns the path |

Unknown commands come back as an error instead of doing something unexpected. Long text is
easier through a file: `cmd selection.set --text-file reply.txt`.

## 5 · Bringing OpenAI back (optional)

The upstream behaviour is still in the code, it is just not the default:

1. uncomment the `gpt-*` entries in `src/index.html` (or in the built panel's markup),
2. pick a model in the dropdown — the panel then re-shows the key icon and the sliders,
3. enter an OpenAI key with the key icon.

Requests for `gpt-*` models go straight to `https://api.openai.com` as before; requests for
the agent models go to the bridge.

## 6 · API

| method | path | who | what |
| --- | --- | --- | --- |
| `POST` | `/v1/chat/completions`, `/v1/responses` | plugin | queue a job; holds the request open up to `?wait=` seconds, then answers `202` with a job id |
| `GET` | `/v1/jobs/:id` | plugin | job status, `?wait=` for long polling |
| `GET` | `/v1/models` | plugin | model list (everything maps to the same queue) |
| `GET` | `/v1/jobs` | agent | list jobs (`?state=`, `?limit=`) |
| `POST` | `/v1/jobs/:id/complete` | agent | `{ text }` or `{ texts: [...] }` |
| `POST` | `/v1/jobs/:id/fail` | agent | `{ error }` |
| `GET`/`POST` | `/v1/indesign/poll` | plugin | long poll for pending commands (`?wait=`) |
| `POST` | `/v1/indesign/result` | plugin | `{ id, ok, result \| error }` |
| `POST` | `/v1/indesign/commands` | agent | `{ op, args }`, `?wait=` waits for the result |
| `GET` | `/v1/indesign/commands/:id` | agent | status/result of one command |
| `GET` | `/api/health`, `/api/state`, `/api/config`, `/api/events` | dashboard | health, full state, config, SSE stream |

Agent endpoints take the token as `x-bridge-token`, `Authorization: Bearer …` or
`?token=…` (only enforced when `BRIDGE_TOKEN` is set).

## 7 · Installing the plugin / running the bridge locally

- The `.ccx` is unsigned — if InDesign will not install it, load the plugin straight from
  `src/` with the UXP Developer Tool, copy `src/` into the UXP plugins folder, or switch on
  player debug mode: **[docs/INSTALL.md](./INSTALL.md)**, and
  **[docs/INSTALL-WINDOWS.md](./INSTALL-WINDOWS.md)** for the exact Windows commands.
- `standalone/indesign-bridge.mjs` is a single-file build of this server (no npm install):
  `node indesign-bridge.mjs`, optionally with `UPSTREAM=…` to relay jobs to a hosted bridge
  so the agent can answer them.

## 8 · Tests

```bash
npm run bridge &                 # in one shell
npm test                         # mocked UXP + InDesign, runs against the live bridge
```

`test/smoke.mjs` loads the real panel code with mocked `uxp`/`indesign` modules and checks
both round trips, that agent mode hides the key/model controls, and that the agent link
comes up by itself.
