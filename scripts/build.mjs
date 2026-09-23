#!/usr/bin/env node
/**
 * Packages the UXP plugin in src/ into Plugin/openai-4-indesign.ccx.
 *
 *   npm run build                              # talks to api.openai.com (upstream behaviour)
 *   BRIDGE_URL=https://host.e2b.app npm run build   # preconfigured for an Arena bridge
 *
 * BRIDGE_URL is baked into lib/config.js (default endpoint) and its origin is added to
 * manifest.json > requiredPermissions.network.domains, which UXP needs before the panel
 * may fetch from that host.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");
const tmpDir = path.join(distDir, ".build");
const outFile = path.join(root, "Plugin", "openai-4-indesign.ccx");

const bridgeUrl = (process.env.BRIDGE_URL || process.argv[2] || "").trim().replace(/\/+$/, "");
let origin = "";
if (bridgeUrl) {
  try {
    origin = new URL(bridgeUrl).origin;
  } catch {
    console.error(`BRIDGE_URL is not a valid URL: ${bridgeUrl}`);
    process.exit(1);
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
fsp.cp(srcDir, tmpDir, { recursive: true }).then(async () => {
  /* 1 · default endpoint */
  const configPath = path.join(tmpDir, "lib", "config.js");
  let config = fs.readFileSync(configPath, "utf8");
  if (!config.includes("__BRIDGE_URL__")) {
    console.warn("! lib/config.js has no __BRIDGE_URL__ placeholder - skipping injection");
  }
  config = config.replace('"__BRIDGE_URL__"', JSON.stringify(bridgeUrl));
  fs.writeFileSync(configPath, config);

  /* 2 · manifest network permission */
  const manifestPath = path.join(tmpDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const domains = manifest?.requiredPermissions?.network?.domains || [];
  /* Wildcards are not guaranteed to be accepted by UXP, so only exact origins go in. */
  const wanted = [origin, "https://api.openai.com"].filter(Boolean);
  for (const d of wanted) {
    if (!domains.includes(d)) domains.push(d);
  }
  manifest.requiredPermissions.network.domains = domains;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  /* 3 · zip */
  fs.rmSync(outFile, { force: true });
  const entries = [];
  const walk = (dir, prefix = "") => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else entries.push(rel);
    }
  };
  walk(tmpDir);
  try {
    execFileSync("zip", ["-X", "-r", "-q", outFile, ...entries], { cwd: tmpDir, stdio: "inherit" });
  } catch {
    console.error("`zip` is not available; falling back to the Node archiver-free path is not supported.");
    process.exit(1);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const size = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n  built  ${path.relative(root, outFile)}  (${size} KB, ${entries.length} files)`);
  console.log(`  bridge ${bridgeUrl || "(none - plugin talks to api.openai.com)"}`);
  console.log(`  domains ${domains.join(", ")}\n`);
});
