"use strict";

/**
 * Arena Link panel.
 *
 * - "Ask the agent" sends an instruction to the bridge; the agent answers and the text
 *   lands in the result field (no OpenAI, no API key, no model selection).
 * - The agent link polls the bridge for commands and runs them against InDesign.
 */

const indesign = require("indesign");
const config = require("../lib/config.js");
const ops = require("./ops.js");

const POLL_INTERVAL_MS = 1200;
const LONG_POLL_WAIT_SEC = 0; /* short requests: proxies in front of the bridge time out on held connections */
const RECONNECT_INTERVAL_MS = 5000;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let linkRunning = false;
let pollTimer = null;

/* ------------------------------------------------------------------- helpers */

const el = (id) => document.getElementById(id);

function headers() {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "User-Agent": BROWSER_UA
  };
}

function setStatus(text, level) {
  const statusElem = el("status");
  if (statusElem) {
    statusElem.textContent = text || "";
    statusElem.classList.remove("ok", "error");
    if (level) statusElem.classList.add(level);
  }
  const linkElem = el("link-status");
  if (linkElem) {
    linkElem.textContent = text || "";
    linkElem.classList.remove("ok", "error");
    if (level) linkElem.classList.add(level);
  }
}

function setError(err) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const errorElem = el("error-message");
  if (errorElem) errorElem.textContent = message;
  console.error(`[arena-link] ${message}`);
}

function clearError() {
  const errorElem = el("error-message");
  if (errorElem) errorElem.textContent = "";
}

function baseApiUrl() {
  const url = config.getBridgeUrl();
  return url ? `${url.replace(/\/+$/, "")}/` : "";
}

/* --------------------------------------------------------------- agent link */

async function startLink() {
  if (!baseApiUrl()) {
    setStatus("No bridge URL", "error");
    return false;
  }
  if (linkRunning) return true;
  linkRunning = true;
  setStatus("Connecting …", "");
  loop();
  return true;
}

function stopLink() {
  linkRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  setStatus("Link off", "");
}

async function loop() {
  while (linkRunning) {
    try {
      await pollOnce();
      await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      setStatus(String(err?.message || err), "error");
      if (!linkRunning) break;
      await sleep(RECONNECT_INTERVAL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOnce() {
  const base = baseApiUrl();
  if (!base) throw new Error("No bridge URL configured");
  const url = new URL(`v1/indesign/poll?wait=${LONG_POLL_WAIT_SEC}&client=arena-link`, base);
  const response = await fetch(url.href, {
    method: "GET",
    headers: Object.assign(headers(), { Authorization: "Bearer arena-link" }),
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(response.status === 403
      ? "403 from the proxy in front of the bridge - use a local bridge (http://localhost:8787)"
      : `Bridge replied with HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  setStatus(`Connected · ${hostLabel()}${data.commands?.length ? ` · ${data.commands.length} command(s)` : ""}`, "ok");
  const commands = data?.commands;
  if (!commands || !(commands instanceof Array) || commands.length === 0) return true;
  for (const command of commands) {
    let ok = false;
    let result = null;
    let error = null;
    try {
      result = await ops.run(command);
      ok = true;
    } catch (err) {
      error = err?.message || String(err);
    }
    console.log(`[arena-link] ${command?.op} -> ${ok ? "ok" : error}`);
    await postResult(command?.id, ok, result, error);
  }
  return true;
}

async function postResult(commandId, ok, result, error) {
  const base = baseApiUrl();
  if (!base || !commandId) return false;
  try {
    await fetch(new URL("v1/indesign/result", base).href, {
      method: "POST",
      headers: Object.assign(headers(), { "Content-Type": "application/json" }),
      body: JSON.stringify({ id: commandId, ok, result, error, client: "arena-link" }),
      redirect: "follow"
    });
  } catch (err) {
    console.error(err);
  }
  return true;
}

function hostLabel() {
  const url = config.getBridgeUrl();
  if (!url) return "";
  return url.replace(/^https?:\/\//, "");
}

/* ------------------------------------------------------------- asking things */

async function sendQuestion() {
  clearError();
  const base = baseApiUrl();
  if (!base) {
    setError(new Error("Set the bridge URL first and press Connect."));
    return false;
  }
  const askElem = el("ask-textarea");
  const contextElem = el("context-textarea");
  const question = String(askElem?.value || "").trim();
  const context = String(contextElem?.value || "").trim();
  if (!question) {
    setError(new Error("Type an instruction first."));
    return false;
  }
  const sendButton = el("send-button");
  if (sendButton) sendButton.setAttribute("disabled", "");
  const previousStatus = el("status")?.textContent || "";
  setStatus("Waiting for the agent …", "");
  try {
    const content = context ? `${question}\n\n${context}` : question;
    const createResponse = await fetch(new URL("v1/chat/completions?wait=0", base).href, {
      method: "POST",
      headers: Object.assign(headers(), { "Content-Type": "application/json", Authorization: "Bearer arena-link" }),
      body: JSON.stringify({ model: "arena-agent", messages: [{ role: "user", content }], n: 1 }),
      redirect: "follow"
    });
    if (!createResponse.ok && createResponse.status !== 202) {
      throw new Error(createResponse.status === 403
        ? "403 from the proxy in front of the bridge - use a local bridge (http://localhost:8787)"
        : `Bridge replied with HTTP ${createResponse.status}`);
    }
    const created = await createResponse.json().catch(() => ({}));
    let answer = extractText(created);
    if (answer === null) {
      answer = await waitForJob(created?.id, base);
    }
    const resultElem = el("result-textarea");
    if (resultElem) resultElem.value = answer || "";
    setStatus(`Connected · ${hostLabel()}`, "ok");
  } catch (err) {
    setError(err);
    setStatus(previousStatus, "");
  } finally {
    if (sendButton) sendButton.removeAttribute("disabled");
  }
  return true;
}

function extractText(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.choices) && payload.choices.length) {
    return payload.choices.map((choice) => choice?.message?.content ?? choice?.text ?? "").join("\n\n");
  }
  if (Array.isArray(payload.output)) {
    const messageItem = payload.output.find((item) => !!item?.content?.[0]?.text) || payload.output[1];
    if (messageItem?.content?.length) return messageItem.content.map((c) => c?.text ?? "").join("\n\n");
  }
  return null;
}

async function waitForJob(jobId, base) {
  if (!jobId) throw new Error("The bridge did not return a job id.");
  const url = new URL(`v1/jobs/${jobId}?wait=0`, base);
  const start = Date.now();
  while (Date.now() - start < JOB_TIMEOUT_MS) {
    const response = await fetch(url.href, {
      method: "GET",
      headers: Object.assign(headers(), { Authorization: "Bearer arena-link" }),
      redirect: "follow"
    });
    if (response.ok) {
      const job = await response.json().catch(() => ({}));
      if (job.state === "done" && job.result) return extractText(job.result) ?? "";
      if (job.state === "error") throw new Error(job.error || "The agent could not answer this request.");
      if (job.state === "cancelled") throw new Error("The request was cancelled.");
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for the agent (15 min).");
}

/* ------------------------------------------------------------ InDesign edits */

function getTextSelection() {
  const { app } = indesign;
  if (!app || app.documents.length === 0 || app.layoutWindows.length === 0) return null;
  const selection = app.properties.selection;
  if (!selection || !(selection instanceof Array) || selection.length === 0) return null;
  const first = selection[0];
  if (!first || !("contents" in first) || !("isValid" in first) || !first.isValid) return null;
  return first;
}

function importSelection() {
  const contextElem = el("context-textarea");
  const selection = getTextSelection();
  if (!selection || !contextElem) return false;
  const contents = selection.contents;
  if (contents === undefined || contents === null) return false;
  contextElem.value = contents instanceof Array ? String(contents.join(" ")) : String(contents);
  return true;
}

function insertResult() {
  const { app, ScriptLanguage, UndoModes } = indesign;
  const resultElem = el("result-textarea");
  const value = String(resultElem?.value || "");
  if (!value) return false;
  app.doScript(placeText, ScriptLanguage.UXPSCRIPT, [value], UndoModes.ENTIRE_SCRIPT, "Arena: insert answer");
  return true;
}

/* Runs inside doScript(): arguments only. */
function placeText(args) {
  const value = args[0];
  const selection = getTextSelection();
  if (!selection) return false;
  const contents = selection.contents;
  if (contents === undefined || contents === null) return false;
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") {
    selection.contents = value;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------- wiring */

function registerHandlers() {
  const connectButton = el("connect-button");
  connectButton?.addEventListener("click", () => {
    clearError();
    const field = el("url-field");
    config.setStoredBridgeUrl(String(field?.value || "").trim());
    stopLink();
    if (config.isAgentEnabled()) startLink();
  });

  const urlField = el("url-field");
  urlField?.addEventListener("change", () => {
    const field = el("url-field");
    config.setStoredBridgeUrl(String(field?.value || "").trim());
  });

  const agentSwitch = el("agent-switch");
  agentSwitch?.addEventListener("change", () => {
    const isEnabled = Boolean(agentSwitch.checked);
    config.setAgentEnabled(isEnabled);
    if (isEnabled) startLink();
    else stopLink();
  });

  el("send-button")?.addEventListener("click", () => {
    sendQuestion();
  });
  el("import-button")?.addEventListener("click", () => {
    importSelection();
  });
  el("insert-button")?.addEventListener("click", () => {
    try {
      insertResult();
    } catch (err) {
      setError(err);
    }
  });
  el("clipboard-button")?.addEventListener("click", () => {
    const resultElem = el("result-textarea");
    if (resultElem && navigator.clipboard) {
      navigator.clipboard.setContent({ "text/plain": resultElem.value });
    }
  });
}

async function setup(rootNode) {
  registerHandlers();
  const urlField = el("url-field");
  if (urlField) urlField.value = config.getBridgeUrl();
  const agentSwitch = el("agent-switch");
  if (agentSwitch) agentSwitch.checked = config.isAgentEnabled();
  if (config.getBridgeUrl() && config.isAgentEnabled()) {
    startLink();
  } else {
    setStatus(config.getBridgeUrl() ? "Link off" : "No bridge URL", config.getBridgeUrl() ? "" : "error");
  }
  return true;
}

async function cleanup() {
  stopLink();
  return true;
}

module.exports = { setup, cleanup, sendQuestion, startLink, stopLink, isLinkRunning: () => linkRunning };
