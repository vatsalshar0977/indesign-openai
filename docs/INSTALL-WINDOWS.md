# Installing on Windows (unsigned `.ccx`)

You need three things: player debug mode ON, no older copy of the same plugin, and a working
install route. Pick **one** of the three install routes — route 3 needs no Creative Cloud and
no installer at all.

---

## Step 0 — download

- Plugin file: **<https://github.com/vatsalshar0977/indesign-openai/raw/arena/01a0cdfa-indesign-openai/Plugin/openai-4-indesign.ccx>**
  (or take it from `Plugin/` in this branch)
- Whole repo as ZIP: **Code → Download ZIP** on the branch page.

Save the `.ccx` to **`C:\`** (e.g. `C:\openai-4-indesign.ccx`). The Creative Cloud installer
only looks on the drive it is running from, and silently fails otherwise.

---

## Step 1 — enable player debug mode (once)

Open **PowerShell as your normal user** (no admin needed) and paste:

```powershell
9..14 | ForEach-Object { reg add "HKCU\Software\Adobe\CSXS.$_" /v PlayerDebugMode /t REG_SZ /d 1 /f }
```

This sets it for every CEP/CSXS version at once, so you don't have to guess which one your
InDesign uses (2023/2024 use CSXS.11). Each line should answer *"The operation completed
successfully."*

Then **restart InDesign** (and the Creative Cloud desktop app if it is running).

---

## Step 2 — remove an older copy of this plugin

If you ever installed the original *OpenAI-4-InDesign* from Adobe Exchange, it has the same
plugin id (`openai4indesign`) and will block this one. Remove it first:

```powershell
# list what is installed
Get-ChildItem "$env:APPDATA\Adobe\UXP\Plugins" -Recurse -Depth 2 | Select-Object FullName

# remove the old one (repeat for the system folder if it shows up there)
Remove-Item "$env:APPDATA\Adobe\UXP\Plugins\External\openai4indesign" -Recurse -Force
Remove-Item "C:\Program Files\Common Files\Adobe\UXP\Plugins\External\openai4indesign" -Recurse -Force
```

---

## Step 3 — install (any one of these)

### Route 1 — double-click (needs Creative Cloud desktop)

1. Creative Cloud desktop app must be running and signed in.
2. Double-click `C:\openai-4-indesign.ccx`.
3. If Windows asks what to open it with, choose **More apps → Look for another app on this PC**
   and pick:
   `C:\Program Files (x86)\Common Files\Adobe\Adobe Desktop Common\UPI\AdobePluginInstallerAgent`
   (or `C:\Program Files\Common Files\Adobe\Adobe Desktop Common\UPI\AdobePluginInstallerAgent`).

### Route 2 — UPIA from the command line (no file association needed)

```powershell
cd "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent"
.\UnifiedPluginInstallerAgent.exe /install C:\openai-4-indesign.ccx
```

If that path does not exist, it may be under `C:\Program Files (x86)\Common Files\Adobe\...`.

### Route 3 — copy the folder (no installer, no Creative Cloud) ★ most reliable

The plugin is just a folder with a `manifest.json`. The `src/` folder in this repo *is* that
folder, already configured for the bridge:

```powershell
# after unzipping the repo ZIP, from inside it:
New-Item -ItemType Directory -Force "$env:APPDATA\Adobe\UXP\Plugins\External\openai4indesign"
Copy-Item "src\*" "$env:APPDATA\Adobe\UXP\Plugins\External\openai4indesign" -Recurse -Force
```

(Equally valid: rename `openai-4-indesign.ccx` to `.zip`, extract it, and copy the extracted
files to the same target folder.)

---

## Step 4 — start InDesign and connect

1. Restart InDesign.
2. **Window → Plugins → OpenAI-4-InDesign** (the panel title is *OpenAI Text*).
3. Click the **link icon** in the panel — the bridge URL is pre-filled, just press OK.
4. Status line under the checkboxes should read **Connected to Arena bridge** (green).
5. Type an instruction and press **Send** — it comes to the agent. No API key anywhere.

---

## If the panel still does not appear

1. **Plugin list cache.** InDesign caches an "installed plugins" list and stops scanning
   folders when the cache exists:
   ```powershell
   Get-ChildItem "$env:APPDATA\Adobe\UXP\PluginsInfo" -Recurse -Depth 2 | Select-Object FullName
   Remove-Item "$env:APPDATA\Adobe\UXP\PluginsInfo\v1" -Recurse -Force
   ```
   Then restart InDesign.
2. **Check the version**: the plugin requires InDesign **18.5+** (2023 or newer).
   *Help → About InDesign*.
3. **Check the manifest id folder name**: the folder under `External\` can be called anything,
   but the `id` inside `manifest.json` must stay `openai4indesign` — do not rename it inside the
   file.
4. **Still nothing?** Use the UXP Developer Tool (Creative Cloud desktop → Beta apps):
   *Add plugin* → select `src\manifest.json` → *Load*. If the panel loads there but not from the
   folder, the folder route is blocked on your machine and the Developer Tool is your answer.
