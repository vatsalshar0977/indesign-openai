#!/usr/bin/env node
/**
 * Agent-facing CLI for the InDesign <-> Arena bridge.
 *
 *   node bridge/cli.mjs status                       # is the bridge + InDesign up?
 *   node bridge/cli.mjs read                         # what is selected in InDesign?
 *   node bridge/cli.mjs frames                       # text frames of the active spread
 *   node bridge/cli.mjs info                         # active document
 *   node bridge/cli.mjs write --file new-text.txt    # replace the selection
 *   node bridge/cli.mjs jobs                         # queued requests waiting for an answer
 *   node bridge/cli.mjs job job_ab12cd34             # full text of one job
 *   node bridge/cli.mjs complete job_ab12cd34 --file reply.txt
 *   node bridge/cli.mjs complete job_ab12cd34 --text "Bonjour le monde"
 *   node bridge/cli.mjs fail job_ab12cd34 --error "…"
 *   node bridge/cli.mjs cmd doc.info                 # ask InDesign something
 *   node bridge/cli.mjs cmd selection.get
 *   node bridge/cli.mjs cmd selection.set --args '{"text":"Hello"}'
 *   node bridge/cli.mjs cmds                         # recent commands + results
 *   node bridge/cli.mjs result cmd_ab12cd34
 *   node bridge/cli.mjs media job_ab12cd34           # paths of images attached to a job
 *   node bridge/cli.mjs url                          # the public URL to paste into the plugin
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");

function baseUrl() {
  if (process.env.BRIDGE_URL) return process.env.BRIDGE_URL.replace(/\/+$/, "");
  try {
    const fromFile = fs.readFileSync(path.join(DATA_DIR, "url.txt"), "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    /* fall through */
  }
  return `http://127.0.0.1:${process.env.PORT || 8787}`;
}

const TOKEN = process.env.BRIDGE_TOKEN || "";

let activeBase = null;

async function api(method, urlPath, body, { wait } = {}) {
  try {
    return await apiOnce(method, urlPath, body, { wait });
  } catch (err) {
    /* The stored URL may be the public one, which is not reachable from inside the sandbox. */
    const fallback = `http://127.0.0.1:${process.env.PORT || 8787}`;
    if (activeBase !== fallback && (activeBase || baseUrl()) !== fallback) {
      activeBase = fallback;
      return await apiOnce(method, urlPath, body, { wait });
    }
    throw err;
  }
}

async function apiOnce(method, urlPath, body, { wait } = {}) {
  const qs = [];
  if (wait) qs.push(`wait=${wait}`);
  if (TOKEN && !urlPath.includes("token=")) qs.push(`token=${encodeURIComponent(TOKEN)}`);
  const separator = urlPath.includes("?") ? "&" : "?";
  const query = qs.length ? `${separator}${qs.join("&")}` : "";
  const base = activeBase || baseUrl();
  const res = await fetch(`${base}${urlPath}${query}`, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN ? { "x-bridge-token": TOKEN } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`HTTP ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  }
  return { status: res.status, json };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const pos = (n) => process.argv.filter((a, i) => i > 1 && !a.startsWith("--"))[n];
const pretty = (o) => console.log(JSON.stringify(o, null, 2));

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    if (process.stdin.isTTY) resolve("");
  });
}

const [cmd, a1] = [pos(0), pos(1)];

(async () => {
  switch (cmd) {
    case "url": {
      console.log(baseUrl());
      break;
    }
    case "status": {
      const { json } = await api("GET", "/api/health");
      console.log(`bridge      ${baseUrl()}`);
      console.log(`uptime      ${json.uptimeSec}s`);
      console.log(`InDesign    ${json.pluginConnected ? "CONNECTED" : "not connected"} (last seen ${json.pluginLastSeen || "never"})`);
      console.log(`pending jobs ${json.counts.pendingJobs}   queued commands ${json.counts.queuedCommands}`);
      break;
    }
    case "jobs": {
      const { json } = await api("GET", `/v1/jobs?state=${arg("state", "")}&limit=${arg("limit", "20")}`);
      const list = json.data || [];
      if (!list.length) {
        console.log("No jobs.");
        break;
      }
      for (const j of list) {
        const preview = j.text.replace(/\s+/g, " ").slice(0, 120);
        console.log(`${j.id}  ${j.state.padEnd(8)} ${j.endpoint.padEnd(20)} ${j.media.length ? `[${j.media.length} img] ` : ""}${preview}`);
      }
      break;
    }
    case "job": {
      const { json } = await api("GET", `/v1/jobs/${a1}`);
      if (has("json")) {
        pretty(json);
        break;
      }
      console.log(`id       ${json.id}`);
      console.log(`state    ${json.state}`);
      console.log(`endpoint ${json.endpoint}   model ${json.model}   n ${json.n}`);
      console.log(`created  ${json.createdAt}`);
      if (json.media?.length) console.log(`media    ${json.media.map((m) => m.path).join(", ")}`);
      console.log("--- request text ---");
      console.log(json.textLength > 400 ? json.text + `\n… (truncated, ${json.textLength} chars total)` : json.text);
      break;
    }
    case "media": {
      const { json } = await api("GET", `/v1/jobs/${a1}`);
      console.log(json.media?.map((m) => m.path).join("\n") || "(no media)");
      break;
    }
    case "complete": {
      let texts;
      if (has("file")) {
        texts = [fs.readFileSync(arg("file"), "utf8")];
      } else if (has("text")) {
        texts = [arg("text", "")];
      } else if (has("texts")) {
        texts = arg("texts", "").split("\n---\n");
      } else {
        texts = [await readStdin()];
      }
      const { json } = await api("POST", `/v1/jobs/${a1}/complete`, { texts });
      console.log(`completed ${json.job.id} (${json.job.state})`);
      break;
    }
    case "fail": {
      const { json } = await api("POST", `/v1/jobs/${a1}/fail`, { error: arg("error", "failed") });
      console.log(`failed ${json.job.id}`);
      break;
    }
    case "read": {
      /* What is selected in InDesign right now? */
      const { json } = await api("POST", "/v1/indesign/commands", { op: "selection.get", args: {} }, { wait: arg("wait", "30") });
      console.log(json.state === "done" ? JSON.stringify(json.result, null, 2) : `${json.state}: ${json.error || ""}`);
      break;
    }
    case "write": {
      /* Replace the selection with text from --file / --text / stdin. */
      const text = has("file") ? fs.readFileSync(arg("file"), "utf8") : has("text") ? arg("text", "") : await readStdin();
      const { json } = await api("POST", "/v1/indesign/commands", { op: "selection.set", args: { text } }, { wait: arg("wait", "30") });
      console.log(json.state === "done" ? `wrote ${json.result?.written ?? text.length} chars` : `${json.state}: ${json.error || ""}`);
      break;
    }
    case "frames": {
      const { json } = await api("POST", "/v1/indesign/commands", { op: "frames.list", args: { limit: Number(arg("limit", "25")) } }, { wait: arg("wait", "30") });
      console.log(json.state === "done" ? JSON.stringify(json.result, null, 2) : `${json.state}: ${json.error || ""}`);
      break;
    }
    case "info": {
      const { json } = await api("POST", "/v1/indesign/commands", { op: "doc.info", args: {} }, { wait: arg("wait", "30") });
      console.log(json.state === "done" ? JSON.stringify(json.result, null, 2) : `${json.state}: ${json.error || ""}`);
      break;
    }
    case "reply": {
      /* Alias for `complete` - answer a request that came from the panel. */
      let texts;
      if (has("file")) texts = [fs.readFileSync(arg("file"), "utf8")];
      else if (has("text")) texts = [arg("text", "")];
      else texts = [await readStdin()];
      const { json } = await api("POST", `/v1/jobs/${a1}/complete`, { texts });
      console.log(`answered ${json.job.id}`);
      break;
    }
    case "cmd":
    case "command": {
      let args = {};
      if (has("args")) args = JSON.parse(arg("args", "{}"));
      else if (has("json")) args = JSON.parse(arg("json", "{}"));
      if (has("args-file")) args = { ...args, ...JSON.parse(fs.readFileSync(arg("args-file"), "utf8")) };
      if (has("text-file")) args = { ...args, text: fs.readFileSync(arg("text-file"), "utf8") };
      if (has("text")) args = { ...args, text: arg("text", "") };
      const { json } = await api("POST", "/v1/indesign/commands", { op: a1, args }, { wait: arg("wait", "30") });
      if (json.state === "queued" || json.state === "sent") {
        console.log(`queued ${json.id} — InDesign is not connected or busy (state: ${json.state})`);
      } else if (json.state === "error") {
        console.log(`error ${json.id}: ${json.error}`);
      } else {
        console.log(JSON.stringify(json.result, null, 2));
      }
      break;
    }
    case "cmds":
    case "commands": {
      const { json } = await api("GET", "/v1/indesign/commands");
      for (const c of json.data || []) {
        console.log(`${c.id}  ${c.state.padEnd(7)} ${c.op.padEnd(20)} ${JSON.stringify(c.args ?? {}).slice(0, 80)}`);
        if (c.result !== null && c.result !== undefined) console.log(`   -> ${JSON.stringify(c.result).slice(0, 200)}`);
        if (c.error) console.log(`   !! ${c.error}`);
      }
      break;
    }
    case "result": {
      const { json } = await api("GET", `/v1/indesign/commands/${a1}`, undefined, { wait: arg("wait", "30") });
      pretty(json);
      break;
    }
    case "watch": {
      /* Prints every new job once - handy as a background process. */
      const seen = new Set();
      console.log(`watching ${baseUrl()} for queued jobs …`);
      for (;;) {
        try {
          const { json } = await api("GET", "/v1/jobs?state=pending&limit=20");
          for (const j of json.data || []) {
            if (seen.has(j.id)) continue;
            seen.add(j.id);
            console.log(`\n=== JOB ${j.id}  ${j.endpoint}  model=${j.model}  n=${j.n}  media=${j.media.length} ===`);
            console.log(j.text.length > 1000 ? j.text.slice(0, 1000) + `\n… (${j.text.length} chars)` : j.text);
            for (const m of j.media) console.log(`image: ${m.path}`);
          }
        } catch (err) {
          console.error(`watch: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    case "help":
    default: {
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
    }
  }
})().catch((err) => {
  console.error(`error: ${err.message}`);
  console.error(`bridge: ${baseUrl()}`);
  process.exit(1);
});
