# Installing the plugin

The `.ccx` in this branch is unsigned, and InDesign refuses unsigned UXP plugins unless
developer mode is on. If double-clicking `Plugin/openai-4-indesign.ccx` does not install it,
use one of the routes below — **Option A needs no packaging and no signing at all**.

All routes assume InDesign **18.5 / 2023 or newer**.

---

## Option A — load the plugin source (recommended, no signing)

The source in `src/` already has the bridge address baked in, so there is nothing to build.

1. Get the source onto your machine:
   - GitHub → branch `arena/01a0cdfa-indesign-openai` → **Code → Download ZIP**, unzip it, **or**
   - `git clone -b arena/01a0cdfa-indesign-openai https://github.com/vatsalshar0977/indesign-openai.git`
2. Install **UXP Developer Tool** (Creative Cloud desktop app → *Beta apps* → UXP Developer Tool) and open it.
3. **Add plugin** → browse to the unzipped folder → select **`src/manifest.json`**.
4. Click **Load** (and *Load Selected* again after any edit). The panel stays loaded while
   InDesign is running; you can also keep it with *Auto load*.
5. In InDesign: *Window → Plugins → OpenAI-4-InDesign* (the panel is called **OpenAI Text**).
6. Click the **link icon** in the panel — the bridge URL is pre-filled, just confirm it. Done:
   the agent link is on by default and no API key is needed.

> If InDesign asks for a developer/unsigned-plugin allowance, switch on player debug mode
> (Option B, step 1) — UXP Developer Tool usually handles this for you.

---

## Option B — install the packaged `.ccx`

1. Enable player debug mode (once per machine). Run in Terminal, then restart InDesign.
   Try `CSXS.9` … `CSXS.12` if one version does nothing.

   **macOS**
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```
   **Windows** (PowerShell as your own user, no admin needed)
   ```powershell
   reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
2. Download `Plugin/openai-4-indesign.ccx` from this branch and double-click it.
   (Creative Cloud / ExManCmd installs it; alternatively place it in the InDesign plugins
   folder and restart.)
3. Open the panel and set the bridge URL with the **link icon** (already pre-filled).

The `.ccx` in this branch is built for the bridge at
`https://8787-ilm424zkdt5d8vzjymrxr.e2b.app`. If the bridge ever runs elsewhere:
```bash
BRIDGE_URL=https://your-host npm run build      # rebuild Plugin/openai-4-indesign.ccx
```

---

## Option C — run the bridge on your own machine

Use this if you would rather not depend on a hosted bridge, or if InDesign cannot reach the
internet. InDesign then talks to `http://localhost:8787` (already allowed in the manifest).

1. Download **`standalone/indesign-bridge.mjs`** (one file, no install, Node 18+ required).
2. Start it:
   ```bash
   node indesign-bridge.mjs                     # http://localhost:8787
   ```
3. In the panel: **link icon** → `http://localhost:8787`.

Two ways to work from there:

- **Self-service** — you answer the queued requests yourself in the dashboard at
  `http://localhost:8787/`. No agent, no internet.
- **Keep the agent in the loop** — relay the jobs to the hosted bridge where the agent is
  watching:
  ```bash
  UPSTREAM=https://8787-ilm424zkdt5d8vzjymrxr.e2b.app \
  UPSTREAM_TOKEN=arena-indesign \
  node indesign-bridge.mjs
  ```
  Your machine only needs outbound HTTPS. The local bridge forwards each request, the agent
  answers upstream, and the answer travels back to InDesign the same way.

### Environment variables

| variable | default | purpose |
| --- | --- | --- |
| `PORT` | `8787` | port (also used for the localhost entries in the manifest) |
| `BRIDGE_TOKEN` | *(none)* | when set, required on the agent endpoints |
| `PUBLIC_URL` | `http://localhost:PORT` | address shown in the dashboard |
| `BRIDGE_DATA_DIR` | `./.data` | where jobs, commands and images are stored |
| `UPSTREAM` | *(none)* | relay jobs to another bridge |
| `UPSTREAM_TOKEN` | *(none)* | token for that upstream bridge |

---

## Checking that it works

```bash
node bridge/cli.mjs status       # "InDesign CONNECTED" once the panel polls in
```
or open the dashboard — the pill in the top right turns green, and the panel's status line
under the checkboxes reads *Connected to Arena bridge*.

Troubleshooting:
- *Panel stays red / "Bridge: HTTP 404"* → the URL is wrong or has a trailing path; it must be
  the bare origin, e.g. `https://8787-xxxxx.e2b.app`.
- *Nothing happens on Send* → open the dashboard; if the request is listed, the link works and
  only the answer is missing (the agent may need a nudge). If nothing is listed, the panel is
  not talking to the bridge — check the URL and the network domains in `src/manifest.json`.
- *HTTP 403 from the bridge* → UXP is blocking the host because it is missing from
  `requiredPermissions.network.domains`; run `node scripts/set-url.mjs <url>` and reload.
