#!/usr/bin/env node
/**
 * InDesign <-> Arena bridge server.
 *
 * Two channels live here:
 *
 *  1. MODEL CHANNEL (OpenAI-compatible)
 *     The UXP plugin in InDesign POSTs to /v1/chat/completions or /v1/responses exactly
 *     like it would to api.openai.com. Instead of calling OpenAI, the request becomes a
 *     *job* in a queue. The Arena agent (or any human with the token) picks the job up,
 *     does the writing/translation/description work, and posts the completion back.
 *     The plugin then receives a normal OpenAI-shaped response. No OpenAI key needed.
 *
 *  2. CONTROL CHANNEL (agent -> InDesign)
 *     The agent enqueues commands (POST /v1/indesign/commands). The plugin long-polls
 *     (GET/POST /v1/indesign/poll), executes them against the InDesign DOM and posts the
 *     result back. The agent reads the result from /v1/indesign/commands/:id.
 *
 * Zero dependencies - Node's built-in http module only.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const AGENT_TOKEN = process.env.BRIDGE_TOKEN || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const DATA_DIR = process.env.BRIDGE_DATA_DIR || path.join(__dirname, ".data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = Number(process.env.MAX_BODY_MB || 64) * 1024 * 1024;
const PLUGIN_TIMEOUT_MS = 90_000; // plugin considered offline after this

fs.mkdirSync(MEDIA_DIR, { recursive: true });

/* ------------------------------------------------------------------ state */

const state = {
  jobs: new Map(),
  commands: new Map(),
  cmdQueue: [],
  plugin: { lastSeen: 0, client: null, host: null },
  startedAt: Date.now(),
};

const jobWaiters = new Map(); // jobId -> [resolve]
const cmdWaiters = []; // [{resolve, timer}]
const sseClients = new Set();

let persistTimer = null;
function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 400);
}

function persist() {
  try {
    const snapshot = {
      jobs: [...state.jobs.values()],
      commands: [...state.commands.values()].slice(-200),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 1));
  } catch (err) {
    console.error("[persist] failed:", err.message);
  }
}

function restore() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const snap = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    for (const job of snap.jobs || []) {
      // Jobs that were still waiting when the server stopped stay waiting.
      if (job.state === "running") job.state = "pending";
      state.jobs.set(job.id, job);
    }
    for (const cmd of snap.commands || []) {
      state.commands.set(cmd.id, cmd);
      if (cmd.state === "queued") state.cmdQueue.push(cmd.id);
    }
    console.log(`[restore] ${state.jobs.size} jobs, ${state.commands.size} commands`);
  } catch (err) {
    console.error("[restore] failed:", err.message);
  }
}

const id = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-4)}`;

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/* ------------------------------------------------------------- http basics */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 0);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isAgent(req, url) {
  const token =
    req.headers["x-bridge-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token") ||
    "";
  if (!AGENT_TOKEN) return true;
  return token === AGENT_TOKEN;
}

function staticFile(res, relPath) {
  const safe = relPath === "/" || relPath === "" ? "/index.html" : relPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safe).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

/* ----------------------------------------------------------- job pipeline */

function saveMedia(jobId, media) {
  const saved = [];
  media.forEach((m, i) => {
    try {
      const buf = Buffer.from(m.data, "base64");
      const ext = (m.mime || "image/png").includes("jpeg") ? ".jpg" : ".png";
      const rel = path.join("media", `${jobId}_${i}${ext}`);
      fs.writeFileSync(path.join(DATA_DIR, rel), buf);
      saved.push({ path: path.join(DATA_DIR, rel), mime: m.mime || "image/png", bytes: buf.length });
    } catch (err) {
      console.error("[media] save failed:", err.message);
    }
  });
  return saved;
}

function extractRequest(body, endpoint) {
  const textParts = [];
  const media = [];

  const collect = (content) => {
    if (typeof content === "string") {
      textParts.push(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part) continue;
      if (part.type === "text") textParts.push(String(part.text || ""));
      else if (part.type === "input_text") textParts.push(String(part.text || ""));
      else if (part.type === "image_url") {
        const raw = typeof part.image_url === "string" ? part.image_url : part.image_url?.url || "";
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(raw);
        if (match) media.push({ mime: match[1], data: match[2] });
      }
    }
  };

  if (Array.isArray(body.messages)) for (const m of body.messages) collect(m?.content);
  if (typeof body.input === "string") textParts.push(body.input);
  else if (Array.isArray(body.input)) for (const m of body.input) collect(m?.content);
  if (typeof body.prompt === "string") textParts.push(body.prompt);

  return {
    text: textParts.join("\n\n").trim(),
    media,
    model: body.model || (endpoint === "v1/responses" ? "arena-agent" : "arena-agent"),
    n: Number(body.n) > 1 ? Number(body.n) : 1,
    temperature: body.temperature,
  };
}

function createJob(endpoint, body, req) {
  const parsed = extractRequest(body, endpoint);
  const job = {
    id: id("job"),
    object: "job",
    state: "pending", // pending -> done | error | cancelled
    endpoint,
    model: parsed.model,
    n: parsed.n,
    temperature: parsed.temperature,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { text: parsed.text, media: [] },
    result: null,
    error: null,
    source: {
      userAgent: req.headers["user-agent"] || "",
      origin: req.headers.origin || "",
      hasApiKey: Boolean(req.headers.authorization),
    },
  };
  job.request.media = saveMedia(job.id, parsed.media);
  state.jobs.set(job.id, job);
  persistSoon();
  console.log(`[job] ${job.id} queued (${endpoint}, ${parsed.text.length} chars, ${job.request.media.length} image(s))`);
  broadcast("job", publicJob(job));
  return job;
}

function completeJob(job, texts, error) {
  job.updatedAt = new Date().toISOString();
  job.completedAt = new Date().toISOString();
  if (error) {
    job.state = "error";
    job.error = String(error);
  } else {
    job.state = "done";
    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === "string");
    job.result = shapeResponse(job, list.length ? list : [""]);
  }
  persistSoon();
  const waiters = jobWaiters.get(job.id) || [];
  jobWaiters.delete(job.id);
  for (const resolve of waiters) resolve(job);
  broadcast("job", publicJob(job));
  return job;
}

function shapeResponse(job, texts) {
  if (job.endpoint === "v1/responses") {
    return {
      id: job.id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: job.model,
      status: "completed",
      output: [
        { id: `${job.id}_reasoning`, type: "reasoning", summary: [] },
        {
          id: `${job.id}_msg`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: texts.map((t) => ({ type: "output_text", text: t, annotations: [] })),
        },
      ],
    };
  }
  return {
    id: job.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: job.model,
    choices: texts.map((t, i) => ({
      index: i,
      message: { role: "assistant", content: t },
      finish_reason: "stop",
    })),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function publicJob(job, { full = false } = {}) {
  return {
    id: job.id,
    state: job.state,
    endpoint: job.endpoint,
    model: job.model,
    n: job.n,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    error: job.error,
    media: job.request.media.map((m) => ({ path: m.path, mime: m.mime, bytes: m.bytes })),
    text: full ? job.request.text : job.request.text.slice(0, 400),
    textLength: job.request.text.length,
    resultText: job.result
      ? job.endpoint === "v1/responses"
        ? (job.result.output?.[1]?.content?.[0]?.text || "")
        : (job.result.choices?.[0]?.message?.content || "")
      : null,
    result: full ? job.result : undefined,
  };
}

function publicCommand(cmd, { full = false } = {}) {
  return {
    id: cmd.id,
    op: cmd.op,
    args: full ? cmd.args : summarizeArgs(cmd.args),
    state: cmd.state,
    createdAt: cmd.createdAt,
    updatedAt: cmd.updatedAt,
    completedAt: cmd.completedAt || null,
    result: cmd.result,
    error: cmd.error,
  };
}

function summarizeArgs(args) {
  if (args === undefined) return undefined;
  try {
    const s = JSON.stringify(args);
    return s && s.length > 200 ? JSON.parse(s.slice(0, 0)) ?? "[large payload]" : args;
  } catch {
    return "[unserialisable]";
  }
}

function waitForJob(job, ms) {
  if (job.state !== "pending") return Promise.resolve(job);
  return new Promise((resolve) => {
    const list = jobWaiters.get(job.id) || [];
    const entry = (j) => {
      clearTimeout(timer);
      resolve(j);
    };
    const timer = setTimeout(() => {
      const l = (jobWaiters.get(job.id) || []).filter((f) => f !== entry);
      if (l.length) jobWaiters.set(job.id, l);
      else jobWaiters.delete(job.id);
      resolve(job);
    }, ms);
    list.push(entry);
    jobWaiters.set(job.id, list);
  });
}

/* ------------------------------------------------------- command pipeline */

function createCommand(op, args, meta = {}) {
  const cmd = {
    id: id("cmd"),
    op: String(op || ""),
    args: args ?? {},
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: meta.createdBy || "agent",
    result: null,
    error: null,
  };
  state.commands.set(cmd.id, cmd);
  state.cmdQueue.push(cmd.id);
  persistSoon();
  flushCmdWaiters();
  broadcast("command", publicCommand(cmd, { full: true }));
  return cmd;
}

function flushCmdWaiters() {
  while (state.cmdQueue.length && cmdWaiters.length) {
    const waiter = cmdWaiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve();
  }
}

function nextCommands() {
  const out = [];
  while (state.cmdQueue.length) {
    const cid = state.cmdQueue.shift();
    const cmd = state.commands.get(cid);
    if (!cmd || cmd.state !== "queued") continue;
    cmd.state = "sent";
    cmd.updatedAt = new Date().toISOString();
    out.push({ id: cmd.id, op: cmd.op, args: cmd.args });
  }
  return out;
}

function finishCommand(cmd, ok, result, error) {
  cmd.state = ok ? "done" : "error";
  cmd.updatedAt = new Date().toISOString();
  cmd.completedAt = new Date().toISOString();
  cmd.result = result ?? null;
  cmd.error = error ? String(error) : null;
  persistSoon();
  broadcast("command", publicCommand(cmd, { full: true }));
}

function waitForCommand(cmd, ms) {
  if (cmd.state === "done" || cmd.state === "error") return Promise.resolve(cmd);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(cmd), ms);
    cmdWaiters.push({ resolve: () => resolve(cmd), timer });
  });
}

function waitForAnyCommand(ms) {
  if (state.cmdQueue.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = cmdWaiters.findIndex((w) => w.resolve === entry);
      if (i >= 0) cmdWaiters.splice(i, 1);
      resolve(false);
    }, ms);
    const entry = () => resolve(true);
    cmdWaiters.push({ resolve: entry, timer });
  });
}

/* ---------------------------------------------------------------- routing */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  try {
    /* ---------------------------------------------------------- dashboard */
    if (req.method === "GET" && (p === "/" || p === "/index.html" || p === "/dashboard")) {
      staticFile(res, "/index.html");
      return;
    }
    if (req.method === "GET" && p.startsWith("/assets/")) {
      staticFile(res, p);
      return;
    }
    if (req.method === "GET" && p === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      const keepAlive = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          /* gone */
        }
      }, 25000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === "GET" && p === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "indesign-arena-bridge",
        uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
        publicUrl: PUBLIC_URL || `http://localhost:${PORT}`,
        pluginConnected: Date.now() - state.plugin.lastSeen < PLUGIN_TIMEOUT_MS,
        pluginLastSeen: state.plugin.lastSeen ? new Date(state.plugin.lastSeen).toISOString() : null,
        counts: {
          pendingJobs: [...state.jobs.values()].filter((j) => j.state === "pending").length,
          queuedCommands: state.cmdQueue.length,
        },
      });
      return;
    }

    if (req.method === "GET" && p === "/api/config") {
      sendJson(res, 200, {
        tokenRequired: Boolean(AGENT_TOKEN),
        publicUrl: PUBLIC_URL || `http://localhost:${PORT}`,
        port: PORT
      });
      return;
    }

    if (req.method === "GET" && p === "/api/state") {
      const jobs = [...state.jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40);
      const cmds = [...state.commands.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40);
      sendJson(res, 200, {
        publicUrl: PUBLIC_URL || `http://localhost:${PORT}`,
        startedAt: new Date(state.startedAt).toISOString(),
        plugin: {
          lastSeen: state.plugin.lastSeen ? new Date(state.plugin.lastSeen).toISOString() : null,
          connected: Date.now() - state.plugin.lastSeen < PLUGIN_TIMEOUT_MS,
          client: state.plugin.client,
          host: state.plugin.host,
        },
        jobs: jobs.map((j) => publicJob(j)),
        commands: cmds.map((c) => publicCommand(c)),
      });
      return;
    }

    /* ------------------------------------------- OpenAI-compatible surface */
    if (req.method === "GET" && p === "/v1/models") {
      sendJson(res, 200, {
        object: "list",
        data: [
          { id: "arena-agent", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "arena" },
          { id: "gpt-4o", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "arena-bridge" },
          { id: "gpt-4.1", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "arena-bridge" },
          { id: "gpt-5", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "arena-bridge" },
          { id: "gpt-4-vision", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "arena-bridge" },
        ],
      });
      return;
    }

    if (req.method === "POST" && (p === "/v1/chat/completions" || p === "/v1/responses" || p === "/v1/completions")) {
      const body = await readBody(req);
      if (body?.stream) {
        sendJson(res, 400, { error: { message: "Streaming is not supported by the Arena bridge. Send stream:false." } });
        return;
      }
      const endpoint = p === "/v1/responses" ? "v1/responses" : "v1/chat/completions";
      const job = createJob(endpoint, body, req);
      const waitMs = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 25) * 1000, 0), 55_000);
      const settled = await waitForJob(job, waitMs);
      if (settled.state === "done") {
        sendJson(res, 200, settled.result);
      } else if (settled.state === "error") {
        sendJson(res, 502, { error: { message: settled.error || "Job failed", job_id: settled.id } });
      } else {
        sendJson(res, 202, {
          id: job.id,
          object: "job",
          state: "pending",
          message: "Queued for the Arena agent. Poll /v1/jobs/" + job.id,
          poll_url: `/v1/jobs/${job.id}`,
          poll_after_ms: 2000,
        });
      }
      return;
    }

    if (req.method === "GET" && p.startsWith("/v1/jobs")) {
      const jobId = p.split("/")[3] || "";
      if (jobId) {
        const job = state.jobs.get(jobId);
        if (!job) return sendJson(res, 404, { error: { message: `Unknown job ${jobId}` } });
        const waitMs = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) * 1000, 0), 55_000);
        const settled = await waitForJob(job, waitMs);
        return sendJson(res, 200, { ...publicJob(settled), result: settled.result });
      }
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      const stateFilter = url.searchParams.get("state") || "";
      let jobs = [...state.jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (stateFilter) jobs = jobs.filter((j) => j.state === stateFilter);
      return sendJson(res, 200, { object: "list", data: jobs.slice(0, limit).map((j) => publicJob(j)) });
    }

    if (req.method === "POST" && p.startsWith("/v1/jobs/") && p.endsWith("/complete")) {
      if (!isAgent(req, url)) return sendJson(res, 401, { error: { message: "Missing or invalid agent token" } });
      const jobId = p.split("/")[3];
      const job = state.jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: { message: `Unknown job ${jobId}` } });
      const body = await readBody(req);
      let texts = body.texts ?? body.choices ?? body.text;
      if (typeof texts === "string") texts = [texts];
      if (!Array.isArray(texts) || !texts.length) return sendJson(res, 400, { error: { message: "Provide `text` or `texts`" } });
      completeJob(job, texts.map(String));
      return sendJson(res, 200, { ok: true, job: publicJob(job) });
    }

    if (req.method === "POST" && p.startsWith("/v1/jobs/") && p.endsWith("/fail")) {
      if (!isAgent(req, url)) return sendJson(res, 401, { error: { message: "Missing or invalid agent token" } });
      const jobId = p.split("/")[3];
      const job = state.jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: { message: `Unknown job ${jobId}` } });
      const body = await readBody(req).catch(() => ({}));
      completeJob(job, null, body.error || body.message || "Failed without reason");
      return sendJson(res, 200, { ok: true, job: publicJob(job) });
    }

    /* ------------------------------------------------ control channel: plugin */
    if (req.method === "GET" || req.method === "POST") {
      if (p === "/v1/indesign/poll") {
        const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
        state.plugin.lastSeen = Date.now();
        state.plugin.client = body.client || state.plugin.client || null;
        state.plugin.host = body.host || state.plugin.host || null;
        const waitMs = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 25) * 1000, 0), 55_000);
        let commands = nextCommands();
        if (!commands.length) {
          await waitForAnyCommand(waitMs);
          commands = nextCommands();
        }
        persistSoon();
        broadcast("plugin", state.plugin);
        return sendJson(res, 200, { ok: true, commands, serverTime: new Date().toISOString() });
      }

      if (p === "/v1/indesign/hello") {
        const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
        state.plugin.lastSeen = Date.now();
        state.plugin.client = body.client || state.plugin.client;
        state.plugin.host = body.host || state.plugin.host || null;
        broadcast("plugin", state.plugin);
        return sendJson(res, 200, { ok: true, bridge: "arena", serverTime: new Date().toISOString() });
      }

      if (p === "/v1/indesign/result") {
        const body = await readBody(req);
        const cmd = state.commands.get(body.id || "");
        if (!cmd) return sendJson(res, 404, { error: { message: `Unknown command ${body.id}` } });
        finishCommand(cmd, Boolean(body.ok), body.result, body.error);
        state.plugin.lastSeen = Date.now();
        return sendJson(res, 200, { ok: true });
      }
    }

    /* ------------------------------------------------- control channel: agent */
    if (req.method === "POST" && p === "/v1/indesign/commands") {
      if (!isAgent(req, url)) return sendJson(res, 401, { error: { message: "Missing or invalid agent token" } });
      const body = await readBody(req);
      const cmd = createCommand(body.op, body.args, { createdBy: body.createdBy || "agent" });
      /* No point holding the request open when InDesign is not polling. */
      const pluginOnline = Date.now() - state.plugin.lastSeen < PLUGIN_TIMEOUT_MS;
      const waitMs = pluginOnline ? Math.min(Math.max(Number(url.searchParams.get("wait") ?? 30) * 1000, 0), 55_000) : 0;
      const settled = await waitForCommand(cmd, waitMs);
      return sendJson(res, 200, { ...publicCommand(settled, { full: true }) });
    }

    if (req.method === "GET" && p === "/v1/indesign/commands") {
      if (!isAgent(req, url)) return sendJson(res, 401, { error: { message: "Missing or invalid agent token" } });
      const list = [...state.commands.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50);
      return sendJson(res, 200, { object: "list", data: list.map((c) => publicCommand(c)) });
    }

    if (req.method === "GET" && p.startsWith("/v1/indesign/commands/")) {
      if (!isAgent(req, url)) return sendJson(res, 401, { error: { message: "Missing or invalid agent token" } });
      const cmdId = p.split("/")[4];
      const cmd = state.commands.get(cmdId);
      if (!cmd) return sendJson(res, 404, { error: { message: `Unknown command ${cmdId}` } });
      const waitMs = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) * 1000, 0), 55_000);
      await waitForCommand(cmd, waitMs);
      return sendJson(res, 200, publicCommand(cmd, { full: true }));
    }

    /* ------------------------------------------------------------- fallback */
    if (req.method === "GET" && (p === "/favicon.ico" || p.endsWith(".svg"))) {
      staticFile(res, p);
      return;
    }
    sendJson(res, 404, { error: { message: `No route for ${req.method} ${p}` } });
  } catch (err) {
    console.error("[error]", err);
    sendJson(res, 500, { error: { message: err?.message || String(err) } });
  }
});

process.on("SIGTERM", () => {
  persist();
  process.exit(0);
});
process.on("SIGINT", () => {
  persist();
  process.exit(0);
});

restore();

server.listen(PORT, HOST, () => {
  const url = PUBLIC_URL || `http://localhost:${PORT}`;
  console.log("");
  console.log("  InDesign <-> Arena bridge");
  console.log(`  listening   http://${HOST}:${PORT}`);
  console.log(`  public url  ${url}`);
  console.log(`  dashboard   ${url}/`);
  console.log(`  agent token ${AGENT_TOKEN || "(none - agent endpoints are open)"}`);
  console.log(`  data dir    ${DATA_DIR}`);
  console.log("");
  try {
    fs.writeFileSync(path.join(DATA_DIR, "url.txt"), `${url}\n`);
  } catch {
    /* ignore */
  }
});
