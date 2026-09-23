# Arena bridge — InDesign without an OpenAI key

The bridge is a small zero-dependency Node server that sits between the InDesign panel and
whoever answers the request. It gives you two things:

1. **Model channel** — the panel keeps working exactly as before, but instead of calling
   `api.openai.com` it hands the request to this server. The request becomes a *job* in a
   queue; an agent (or you, in the dashboard) writes the answer and it is delivered back to
   the panel as a normal OpenAI-shaped response. **No OpenAI account or API key needed.**
2. **Control channel** — commands can be sent the other way: from here into InDesign
   (read the document, replace text, list frames, export a PDF …) and the result comes back.

```
InDesign panel  ──POST /v1/chat/completions──▶  bridge  ──job queue──▶  agent (or dashboard)
                ◀──202 + poll /v1/jobs/:id───           ◀──complete────

bridge ──POST /v1/indesign/commands──▶ queue ──long poll──▶ InDesign panel ──result──▶ bridge
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
queued requests, command results and the address to paste into the plugin.

## 2 · Point the plugin at the bridge

**Packaged plugin (`.ccx`)** — bake the address in at build time:

```bash
BRIDGE_URL=https://8787-xxxxx.e2b.app npm run build     # -> dist/openai-4-indesign.ccx
```

That writes the URL into `lib/config.js` and adds its origin to
`manifest.json > requiredPermissions.network.domains`, which UXP requires before the panel
may talk to a host. Install the `.ccx` as usual (double-click; unsigned plugins need
InDesign's player debug mode enabled).

**From source with the UXP Developer Tool**:

```bash
node scripts/set-url.mjs https://8787-xxxxx.e2b.app     # adds the origin to src/manifest.json
```

**At runtime** — click the **link icon** next to the key icon in the panel and paste the
bridge URL. Whatever you enter there wins over the baked-in value. Leave it empty to go
back to talking to `api.openai.com` directly.

> The address is fixed at build time because UXP whitelists network domains in the
> manifest. If the bridge moves to a new host, rebuild (or re-run `set-url.mjs`).

## 3 · Use it

- **Model requests**: type an instruction in the panel and press **Send**. The request shows
  up on the dashboard under *Waiting for the agent*. Answer it there, or let the agent pick
  it up:
  ```bash
  node bridge/cli.mjs jobs                       # what is waiting?
  node bridge/cli.mjs job job_ab12cd34           # read the full request
  node bridge/cli.mjs complete job_ab12cd34 --text "Guten Morgen"
  #   … --file reply.txt      answer from a file
  #   … --stdin               answer from a pipe
  node bridge/cli.mjs media job_ab12cd34         # paths of attached images (image description)
  node bridge/cli.mjs fail job_ab12cd34 --error "too blurry"
  ```
  The panel polls every ~20 s and shows the answer the moment it lands — the spinner reads
  *“Waiting for the agent …”* until then. Image uploads (the `gpt-4-vision` model) are saved
  to `bridge/.data/media/` so they can be viewed.
- **No API key is needed in bridge mode** — the panel uses a placeholder key which the
  bridge ignores. Alt-click the key icon to remove a real key when you switch back.

## 4 · Drive InDesign from here

Tick **Agent link** in the panel. The panel starts long-polling the bridge; each command is
executed inside `app.doScript()` (one undo step per command, no `eval`, only the ops below
are accepted).

```bash
node bridge/cli.mjs status
node bridge/cli.mjs cmd ping                                  # proves the round trip
node bridge/cli.mjs cmd doc.info                              # active document
node bridge/cli.mjs cmd selection.get                         # text of the current selection
node bridge/cli.mjs cmd selection.set --args '{"text":"Hi"}'   # replace it
node bridge/cli.mjs cmds                                      # history + results
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

Unknown commands come back as an error instead of doing something unexpected.

## 5 · API

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
| `GET` | `/api/health`, `/api/state`, `/api/events` | dashboard | health, full state, SSE stream |

Agent endpoints take the token as `x-bridge-token`, `Authorization: Bearer …` or
`?token=…` (only enforced when `BRIDGE_TOKEN` is set).

## 6 · Tests

```bash
npm run bridge &                 # in one shell
npm test                         # mocked UXP + InDesign, runs against the live bridge
```

`test/smoke.mjs` loads the real panel code with mocked `uxp`/`indesign` modules and checks
both round trips: Send → job → answer → output field, and command → poll → DOM → result.
