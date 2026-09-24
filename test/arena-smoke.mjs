/**
 * Smoke test for the Arena Link plugin (arena-link/).
 *
 * Mocks UXP + InDesign, then runs the real panel code against a live bridge:
 *   1. asking: panel -> job -> agent answer -> result field
 *   2. control: agent command -> running link -> InDesign mock -> result back
 *
 * Usage: node bridge/server.mjs & node test/arena-smoke.mjs
 */

import Module from "node:module";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const BRIDGE = process.env.BRIDGE_URL || "http://127.0.0.1:8787";
const TOKEN = process.env.BRIDGE_TOKEN || "arena-indesign";

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

/* ---------------------------------------------------------------- DOM mock */

class El {
  constructor(id = "", tag = "div") {
    this.id = id;
    this.tagName = tag;
    this.value = "";
    this.textContent = "";
    this.checked = false;
    this.attrs = {};
    this.handlers = {};
    this.classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this.classes.add(x)),
      remove: (...c) => c.forEach((x) => this.classes.delete(x)),
      contains: (c) => this.classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this.classes.has(c) : Boolean(force);
        if (on) this.classes.add(c); else this.classes.delete(c);
        return on;
      },
    };
  }
  addEventListener(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
  }
  removeEventListener() {}
  async dispatch(type, evt = {}) {
    for (const fn of this.handlers[type] || []) await fn({ currentTarget: this, target: this, ...evt });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const elements = new Map();
const getEl = (id) => {
  if (!elements.has(id)) elements.set(id, new El(id));
  return elements.get(id);
};

global.document = {
  documentElement: new El("html"),
  body: new El("body"),
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => new El("", tag),
};

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
Object.defineProperty(global, "navigator", {
  value: { onLine: true, clipboard: { setContent: () => {} } },
  configurable: true,
  writable: true,
});

/* --------------------------------------------------- UXP / InDesign mocks */

const uxpMock = {
  host: { locale: "en_US", uiLocale: "en_US" },
  storage: {
    secureStorage: { getItem: async () => new Uint8Array(), setItem: async () => {}, removeItem: async () => {} },
    localFileSystem: { getEntryWithUrl: async () => null },
    formats: { binary: "binary", utf8: "utf8" },
  },
  entrypoints: { setup: () => {} },
};

const collection = (items) => {
  const c = { length: items.length, item: (i) => items[i] ?? null, firstItem: () => items[0] ?? null, lastItem: () => items[items.length - 1] ?? null };
  items.forEach((x, i) => { c[i] = x; });
  return c;
};

const appended = { text: "" };
const frame = { isValid: true, name: "Frame A", label: "", contents: "Hello world" };
const story = { isValid: true, index: 0, insertionPoints: { lastItem: () => ({ set contents(v) { appended.text = v; } }) } };
const page = { isValid: true, name: "1", documentOffset: 0, allPageItems: collection([frame]), textFrames: collection([frame]), rectangles: collection([]) };
const doc = {
  isValid: true,
  name: "Test.indd",
  fullName: { nativePath: "/tmp/Test.indd" },
  saved: true,
  modified: false,
  pages: collection([{}, {}]),
  spreads: collection([{ name: "A", isValid: true, textFrames: collection([frame]) }]),
  stories: collection([story]),
  links: collection([]),
  documentPreferences: { pageWidth: 210, pageHeight: 297, facingPages: false },
  viewPreferences: { horizontalMeasurementUnits: "Millimeters", verticalMeasurementUnits: "Millimeters" },
  textFrames: collection([frame]),
  paragraphStyles: collection([{ isValid: true, name: "[No Paragraph Style]" }]),
  characterStyles: collection([{ isValid: true, name: "[None]" }]),
  save: () => true,
  exportFile: () => { throw new Error("export not mocked"); },
};
const app = {
  name: "Adobe InDesign",
  version: "20.0",
  documents: collection([doc]),
  layoutWindows: collection([{}]),
  activeDocument: doc,
  activeWindow: { activePage: page, activeSpread: doc.spreads.item(0) },
  properties: { selection: [frame] },
  doScript: (fn, lang, args) => fn(args),
  addEventListener: () => {},
  removeEventListener: () => {},
};
const indesignMock = {
  app,
  ScriptLanguage: { UXPSCRIPT: "uxpscript" },
  UndoModes: { ENTIRE_SCRIPT: "entire" },
  SourceType: { SOURCE_CUSTOM: "custom" },
  NothingEnum: { NOTHING: "nothing" },
  ExportFormat: { PDF_TYPE: "pdf", JPG_TYPE: "jpg" },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === "uxp") return uxpMock;
  if (request === "indesign") return indesignMock;
  return originalLoad.apply(this, arguments);
};

/* ---------------------------------------------------------------- helpers */

const api = async (method, urlPath, body) => {
  const res = await fetch(`${BRIDGE}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${BRIDGE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Bridge not reachable at ${BRIDGE}. Start it first: npm run bridge`);
  process.exit(1);
}

/* ------------------------------------------------------------------- tests */

console.log("\n[Arena Link] panel setup");
localStorage.setItem("arena-bridge-url", BRIDGE);
localStorage.setItem("arena-agent-enabled", "1");

const panel = require(path.join(root, "arena-link", "panel", "panel.js"));
const ok = await panel.setup(document.body);
check("setup() returns true", ok === true);
check("agent link starts automatically", panel.isLinkRunning() === true);
check("URL field is pre-filled", getEl("url-field").value === BRIDGE, getEl("url-field").value);
check("agent switch is on", getEl("agent-switch").checked === true);

console.log("\n[Arena Link] asking the agent");
getEl("ask-textarea").value = "Rewrite this as a headline: Arena agent drives InDesign";
getEl("context-textarea").value = "";

let answered = null;
const agentLoop = (async () => {
  const deadline = Date.now() + 60_000;
  while (!answered && Date.now() < deadline) {
    const list = await api("GET", "/v1/jobs?state=pending&limit=10");
    for (const job of list.data || []) {
      if (job.text.includes("Rewrite this as a headline")) {
        await api("POST", `/v1/jobs/${job.id}/complete`, { texts: ["Arena Agent Now Drives InDesign"] });
        answered = job.id;
        break;
      }
    }
    await sleep(200);
  }
})();

getEl("send-button").dispatch("click");
const waitDeadline = Date.now() + 60_000;
while (!getEl("result-textarea").value && Date.now() < waitDeadline) await sleep(200);
await agentLoop;
check("job was answered", answered !== null);
check("answer landed in the result field", getEl("result-textarea").value === "Arena Agent Now Drives InDesign", getEl("result-textarea").value);
check("status shows connected", /Connected/.test(getEl("status").textContent), getEl("status").textContent);

console.log("\n[Arena Link] agent commands");
const created = [];
for (const [op, args] of [["ping", {}], ["doc.info", {}], ["page.info", {}], ["selection.get", {}], ["selection.set", { text: "Überschrieben" }], ["text.append", { text: "!" }], ["nope.nope", {}]]) {
  const cmd = await api("POST", "/v1/indesign/commands?wait=0", { op, args });
  created.push([op, cmd.id]);
}

const cmdDeadline = Date.now() + 60_000;
const results = {};
for (const [op, id] of created) {
  for (;;) {
    const cmd = await api("GET", `/v1/indesign/commands/${id}`);
    if (cmd.state === "done" || cmd.state === "error" || Date.now() > cmdDeadline) {
      results[op] = cmd;
      break;
    }
    await sleep(300);
  }
}

check("ping", results.ping.state === "done" && results.ping.result.bridge === "arena", JSON.stringify(results.ping.result));
check("doc.info", results["doc.info"].state === "done" && results["doc.info"].result.name === "Test.indd", JSON.stringify(results["doc.info"].result));
check("page.info", results["page.info"].state === "done" && results["page.info"].result.name === "1", JSON.stringify(results["page.info"].result));
check("selection.get", results["selection.get"].state === "done" && results["selection.get"].result.selection[0].text === "Hello world", JSON.stringify(results["selection.get"].result));
check("selection.set", results["selection.set"].state === "done" && frame.contents === "Überschrieben", frame.contents);
check("text.append", results["text.append"].state === "done" && appended.text === "!", appended.text);
check("unknown op is rejected", results["nope.nope"].state === "error" && /Unknown command/.test(results["nope.nope"].error), results["nope.nope"].error);

console.log("\n[Arena Link] proxy access token header");
const seen = [];
const realFetch = global.fetch;
global.fetch = (url, opts) => {
  seen.push({ url: String(url), headers: opts?.headers || {} });
  return realFetch(url, opts);
};
panel.stopLink();
localStorage.setItem("arena-traffic-token", "test-token-123");
panel.startLink();
await sleep(2000);
const polls = seen.filter((r) => r.url.includes("/v1/indesign/poll"));
check("poll requests were sent", polls.length > 0);
check("traffic token header is attached", polls.some((r) => r.headers["e2b-traffic-access-token"] === "test-token-123"), JSON.stringify(polls[0]?.headers || {}));
global.fetch = realFetch;

panel.stopLink();
check("link stops", panel.isLinkRunning() === false);

console.log(failures === 0 ? "\nAll Arena Link checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures ? 1 : 0);
