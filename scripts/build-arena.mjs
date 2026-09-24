#!/usr/bin/env node
/**
 * Packages the Arena Link plugin (arena-link/) into Plugin/ArenaLink.ccx.
 *
 *   npm run build:arena                                   # no default bridge URL
 *   BRIDGE_URL=https://host.e2b.app npm run build:arena   # bridge address baked in
 *
 * BRIDGE_URL is written into lib/config.js and its origin is added to
 * manifest.json > requiredPermissions.network.domains.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "arena-link");
const tmpDir = path.join(root, "Plugin", ".build-arena");
const outFile = path.join(root, "Plugin", "ArenaLink.ccx");

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

await fsp.cp(srcDir, tmpDir, { recursive: true });

/* 1 · default bridge address */
const configPath = path.join(tmpDir, "lib", "config.js");
const config = fs.readFileSync(configPath, "utf8");
fs.writeFileSync(configPath, config.replace(/var BUILD_BRIDGE_URL = "[^"]*";/, `var BUILD_BRIDGE_URL = ${JSON.stringify(bridgeUrl)};`));

/* 2 · network permission */
const manifestPath = path.join(tmpDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const domains = manifest?.requiredPermissions?.network?.domains || [];
for (const d of ["https://*.e2b.app", origin, "http://localhost:8787", "http://127.0.0.1:8787"].filter(Boolean)) {
  if (!domains.includes(d)) domains.push(d);
}
manifest.requiredPermissions.network.domains = domains;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

/* 3 · zip (directory entries included, like upstream .ccx files) */
fs.rmSync(outFile, { force: true });
const entries = [];
const walk = (dir, prefix = "") => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      entries.push(`${rel}/`);
      walk(full, rel);
    } else {
      entries.push(rel);
    }
  }
};
walk(tmpDir);
execFileSync("zip", ["-X", "-r", "-q", outFile, ...entries], { cwd: tmpDir, stdio: "inherit" });
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n  built  Plugin/ArenaLink.ccx (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB, ${entries.length} entries)`);
console.log(`  bridge ${bridgeUrl || "(none - set it in the panel)"}`);
console.log(`  domains ${domains.join(", ")}\n`);
