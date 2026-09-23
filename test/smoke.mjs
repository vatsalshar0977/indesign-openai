/**
 * Smoke test for the patched UXP plugin code.
 *
 * InDesign and UXP are not available in a sandbox, so this harness mocks both and runs
 * the real panel code (src/panel/create.js, src/panel/bridge.js) against a live bridge:
 *
 *   1. "Send" in the panel -> job on the bridge -> agent answers -> text lands in the output field
 *   2. agent command -> plugin long poll -> InDesign DOM mock -> result back to the agent
 *
 * Usage: node bridge/server.mjs & node test/smoke.mjs
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
    };
  }
  addEventListener(type, fn) {
    (this.handlers[type] = this.handlers[type] || []).push(fn);
  }
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

/* --------------------------------------------- UXP / InDesign mocks */

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

const frame = { isValid: true, name: "Frame A", label: "", contents: "Hello world" };
const appended = { text: "" };
const story = {
  isValid: true,
  index: 0,
  insertionPoints: { lastItem: () => ({ set contents(v) { appended.text = v; } }) },
};
const doc = {
  isValid: true,
  name: "Test.indd",
  fullName: { nativePath: "/tmp/Test.indd" },
  saved: true,
  modified: false,
  pages: collection([{}, {}]),
  spreads: collection([{}]),
  stories: collection([story]),
  links: collection([]),
  documentPreferences: { pageWidth: 210, pageHeight: 297, facingPages: false },
  viewPreferences: { horizontalMeasurementUnits: "Millimeters", verticalMeasurementUnits: "Millimeters" },
  textFrames: collection([frame]),
  paragraphStyles: collection([{ isValid: true, name: "[No Paragraph Style]" }]),
  characterStyles: collection([{ isValid: true, name: "[None]" }]),
  exportFile: () => { throw new Error("export not mocked"); },
};

const app = {
  name: "Adobe InDesign",
  version: "20.0",
  documents: collection([doc]),
  layoutWindows: collection([{}]),
  activeDocument: doc,
  activeWindow: { activePage: { name: "1", textFrames: collection([frame]) }, activeSpread: null },
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
  ExportFormat: { PDF_TYPE: "pdf" },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
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

/* Test 1: panel "Send" round trip ---------------------------------------- */

async function testModelChannel() {
  const t0 = Date.now();
  console.log("\n[1] Model channel: panel Send -> bridge -> agent -> panel");
  localStorage.setItem("arena-bridge-url", BRIDGE);
  localStorage.setItem("arena-bridge-enabled", "0");

  const create = require(path.join(root, "src", "panel", "create.js"));
  const ok = await create.setup(document.body);
  check("setup() returns true", ok === true);

  getEl("model-dropdown").value = "gpt-4o";
  getEl("n-slider").value = "1";
  getEl("temperature-slider").value = "0.7";
  getEl("instruction-textarea").value = "Translate to German: Good morning";
  getEl("optional-input-textarea").value = "";

  /* Stand-in for the agent: watch for the job and answer it. */
  let answered = null;
  const agentLoop = (async () => {
    const deadline = Date.now() + 60_000;
    while (!answered && Date.now() < deadline) {
      const list = await api("GET", "/v1/jobs?state=pending&limit=10");
      for (const job of list.data || []) {
        if (job.text.includes("Translate to German")) {
          await api("POST", `/v1/jobs/${job.id}/complete`, { texts: ["Guten Morgen"] });
          answered = job.id;
          break;
        }
      }
      await sleep(200);
    }
  })();

  /* The panel handler runs asynchronously, so fire the click and wait for the result. */
  getEl("send-button").dispatch("click");
  const waitDeadline = Date.now() + 60_000;
  while (!getEl("output-textarea").value && Date.now() < waitDeadline) await sleep(200);
  await agentLoop;
  check("job was answered by the agent", answered !== null);
  const output = getEl("output-textarea").value;
  console.log(`  (model channel took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check("answer arrived in the output field", output === "Guten Morgen", `got "${output}"`);
  check("error message element stays empty", getEl("input-error-message").textContent === "", getEl("input-error-message").textContent);
}

/* Test 2: agent commands -> InDesign mock --------------------------------- */

async function testControlChannel() {
  const t1 = Date.now();
  console.log("\n[2] Control channel: agent command -> plugin poll -> InDesign");
  const bridge = require(path.join(root, "src", "panel", "bridge.js"));

  const created = [];
  for (const [op, args] of [["ping", {}], ["doc.info", {}], ["selection.get", {}], ["selection.set", { text: "Ersetzt" }], ["unknown.op", {}]]) {
    const cmd = await api("POST", "/v1/indesign/commands?wait=0", { op, args });
    created.push([op, cmd.id]);
  }
  check("commands queued", created.length === 5);

  await bridge.runOnce();

  const byOp = Object.fromEntries(created);
  const results = {};
  for (const [op, id] of created) {
    results[op] = await api("GET", `/v1/indesign/commands/${id}`);
  }

  check("ping -> app name", results.ping.state === "done" && results.ping.result.app === "Adobe InDesign", JSON.stringify(results.ping.result));
  check("doc.info -> name + pages", results["doc.info"].state === "done" && results["doc.info"].result.name === "Test.indd" && results["doc.info"].result.pages === 2, JSON.stringify(results["doc.info"].result));
  check("selection.get -> frame text", results["selection.get"].state === "done" && results["selection.get"].result.selection[0].text === "Hello world", JSON.stringify(results["selection.get"].result));
  check("selection.set -> writes the frame", results["selection.set"].state === "done" && frame.contents === "Ersetzt", frame.contents);
  check("unknown op -> error reported", results["unknown.op"].state === "error" && /Unknown command/.test(results["unknown.op"].error), results["unknown.op"].error);

  console.log(`  (control channel took ${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  bridge.stop();
}

/* -------------------------------------------------------------------- run */

const health = await fetch(`${BRIDGE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Bridge not reachable at ${BRIDGE}. Start it first: npm run bridge`);
  process.exit(1);
}

await testModelChannel();
await testControlChannel();

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures ? 1 : 0);
