#!/usr/bin/env node
/**
 * Adds the Arena bridge origin to src/manifest.json so the plugin may talk to it.
 * Needed when the plugin is loaded from source with the UXP Developer Tool
 * (`npm run build` does this automatically for the packaged .ccx).
 *
 *   node scripts/set-url.mjs https://8787-abc.e2b.app
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src", "manifest.json");
const input = process.argv[2] || process.env.BRIDGE_URL || "";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const domains = manifest?.requiredPermissions?.network?.domains || [];

if (!input) {
  console.log("Current domains:", domains.join(", "));
  process.exit(0);
}

let origin;
try {
  origin = new URL(input).origin;
} catch {
  console.error(`Not a valid URL: ${input}`);
  process.exit(1);
}

if (!domains.includes(origin)) domains.push(origin);
manifest.requiredPermissions.network.domains = domains;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Added ${origin} to src/manifest.json`);
console.log("Domains now:", domains.join(", "));
