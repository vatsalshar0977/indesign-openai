"use strict";

/**
 * Agent link: lets the Arena bridge drive InDesign.
 *
 * A long poll (GET {bridge}/v1/indesign/poll) delivers commands, they are executed
 * against the InDesign DOM inside app.doScript() and the result is posted back to
 * {bridge}/v1/indesign/result.
 *
 * No eval, no arbitrary code: only the ops listed in dispatch() are accepted.
 */

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function")
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var bridge_exports = {};
__export(bridge_exports, {
  start: () => start,
  stop: () => stop,
  isRunning: () => isRunning,
  setStatusHandler: () => setStatusHandler,
  runOnce: () => runOnce
});
module.exports = __toCommonJS(bridge_exports);

var import_config = require("../lib/config.js");

const indesign = require("indesign");

const POLL_INTERVAL_MS = 1500;
const LONG_POLL_WAIT_SEC = 20;
const RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_TEXT_LIMIT = 4000;
/* Some reverse proxies in front of the bridge reject non-browser clients with 403. */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function browserHeaders(extra) {
  return Object.assign({
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": BROWSER_UA,
    "Cache-Control": "no-cache"
  }, extra || {});
}

let running = false;
let statusHandler = null;
let timer = null;

/* Result channel from inside app.doScript() back to the poller. */
let lastResult = null;
let lastError = null;

function setStatusHandler(handler) {
  statusHandler = typeof handler === "function" ? handler : null;
}

function emitStatus(text, level) {
  if (statusHandler) {
    try {
      statusHandler(text, level || "");
    } catch (err) {
      /* ignore */
    }
  }
  console.log(`[agent-link] ${text}`);
}

function isRunning() {
  return running;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseApiUrl() {
  const url = import_config.getBridgeUrl();
  if (!url) return "";
  return url.replace(/\/+$/, "") + "/";
}

async function start() {
  if (running) return true;
  const base = baseApiUrl();
  if (!base) {
    emitStatus("No bridge URL configured", "error");
    return false;
  }
  running = true;
  emitStatus("Connecting …", "");
  loop();
  return true;
}

function stop() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  emitStatus("Link off", "");
}

async function loop() {
  while (running) {
    try {
      await runOnce();
      await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      emitStatus(String(err?.message || err), "error");
      if (!running) break;
      await sleep(RECONNECT_INTERVAL_MS);
    }
  }
}

/** Single poll cycle: fetch pending commands, execute them, report back. */
async function runOnce() {
  const base = baseApiUrl();
  if (!base) throw new Error("No bridge URL configured");
  const url = new URL(`v1/indesign/poll?wait=${LONG_POLL_WAIT_SEC}`, base);
  const response = await fetch(url.href, {
    method: "GET",
    headers: browserHeaders({ Authorization: "Bearer arena-bridge" }),
    redirect: "follow"
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("403 from the host in front of the bridge (proxy). Run the bridge locally (link icon → http://localhost:8787) or check the URL.");
    }
    throw new Error(`Bridge replied with HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  emitStatus("Connected to Arena bridge", "ok");
  const commandArray = data?.commands;
  if (!commandArray || !(commandArray instanceof Array) || commandArray.length === 0) {
    return true;
  }
  for (const command of commandArray) {
    let ok = false;
    let result = null;
    let error = null;
    try {
      result = await execute(command);
      ok = true;
    } catch (err) {
      error = err?.message || String(err);
    }
    console.log(`[agent-link] ${command?.op} -> ${ok ? "ok" : error}`);
    await postResult(command?.id, ok, result, error);
  }
  return true;
}

async function postResult(commandId, ok, result, error) {
  const base = baseApiUrl();
  if (!base || !commandId) return false;
  const url = new URL("v1/indesign/result", base);
  try {
    await fetch(url.href, {
      method: "POST",
      headers: browserHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: commandId, ok, result, error, client: "indesign-uxp" }),
      redirect: "follow"
    });
  } catch (err) {
    console.error(err);
  }
  return true;
}

/* ------------------------------------------------------------ execution */

async function execute(command) {
  const { app, ScriptLanguage, UndoModes } = indesign;
  if (!app) throw new Error("InDesign is not available.");
  lastResult = null;
  lastError = null;
  app.doScript(
    executeInside,
    ScriptLanguage.UXPSCRIPT,
    [command],
    UndoModes.ENTIRE_SCRIPT,
    `Arena bridge: ${command?.op || "command"}`
  );
  if (lastError) {
    throw new Error(lastError);
  }
  return lastResult === undefined ? null : lastResult;
}

/* Runs in the InDesign script context - no closure access, args only. */
function executeInside(args) {
  const command = args[0] || {};
  try {
    lastResult = dispatch(command);
    lastError = null;
  } catch (err) {
    lastResult = null;
    lastError = err?.message || String(err);
  }
}

function limit(text, max) {
  const value = text === undefined || text === null ? "" : String(text);
  const maxChars = Number(max) > 0 ? Number(max) : DEFAULT_TEXT_LIMIT;
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + `… [truncated, ${value.length} chars total]`;
}

function kindOf(item) {
  if (!item) return "none";
  return item.constructor?.name || typeof item;
}

function textOfSelection(selection, args) {
  const contents = selection.contents;
  if (contents === undefined || contents === null) return "";
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") {
    return String(contents);
  }
  if (contents instanceof Array && "rows" in selection && "columns" in selection) {
    const separator = args?.columnSeparator || "|";
    const rowSeparator = args?.rowSeparator || "\n";
    const columnCount = selection.columns.length;
    const rowCount = selection.rows.length;
    const rows = [];
    for (let r = 0; r < rowCount; r += 1) {
      rows.push(contents.slice(r * columnCount, (r + 1) * columnCount).join(separator));
    }
    return rows.join(rowSeparator);
  }
  return "";
}

function writeSelection(selection, text, args) {
  if (!selection || !selection.isValid) return false;
  const contents = selection.contents;
  if (contents === undefined || contents === null) return false;
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") {
    selection.contents = text;
    return true;
  }
  if (contents instanceof Array && "rows" in selection && "columns" in selection) {
    const columnSeparator = args?.columnSeparator || "|";
    const rowSeparator = args?.rowSeparator || "\n";
    let table = selection;
    if (selection.constructor.name === "Cell") {
      table = selection.parent;
    }
    if (table.constructor.name !== "Table") return false;
    const firstColumn = selection.columns.firstItem();
    const firstRow = selection.rows.firstItem();
    if (!firstColumn.isValid || !firstRow.isValid) return false;
    const columnCount = selection.columns.length;
    const rowCount = selection.rows.length;
    const splitRegExp = new RegExp(`[${columnSeparator}${rowSeparator.replace(/\\n/, "\n")}]+`, "i");
    const valueArray = String(text).split(splitRegExp);
    let i = 0;
    for (let r = firstRow.index; r < rowCount + firstRow.index; r += 1) {
      for (let c = firstColumn.index; c < columnCount + firstColumn.index; c += 1) {
        const cell = table.cells.itemByName(`${c}:${r}`);
        if (!cell.isValid) continue;
        cell.contents = valueArray[i] ?? "";
        i += 1;
      }
    }
    return true;
  }
  return false;
}

function safePath(doc) {
  try {
    const fullName = doc.fullName;
    if (!fullName) return null;
    return fullName.nativePath || String(fullName);
  } catch (err) {
    return null;
  }
}

function selectionArray() {
  const { app } = indesign;
  if (!app || app.documents.length === 0 || app.layoutWindows.length === 0) return null;
  const selection = app.properties.selection;
  if (!selection || !(selection instanceof Array) || selection.length === 0) return null;
  return selection;
}

function dispatch(command) {
  const { app } = indesign;
  const op = String(command?.op || "");
  const args = command?.args || {};

  switch (op) {
    case "ping":
      return { app: app.name, version: app.version, documents: app.documents.length };

    case "app.info": {
      const doc = app.documents.length ? app.activeDocument : null;
      return {
        app: app.name,
        version: app.version,
        documents: app.documents.length,
        activeDocument: doc && doc.isValid ? doc.name : null,
        selection: (() => {
          const s = selectionArray();
          return s ? s.map((item) => kindOf(item)) : [];
        })()
      };
    }

    case "doc.list": {
      const docs = [];
      for (let i = 0; i < app.documents.length; i += 1) {
        const doc = app.documents.item(i);
        if (!doc || !doc.isValid) continue;
        docs.push({
          index: i,
          name: doc.name,
          path: safePath(doc),
          pages: doc.pages.length,
          saved: doc.saved,
          active: doc === app.activeDocument
        });
      }
      return docs;
    }

    case "doc.info": {
      if (app.documents.length === 0) return { open: false };
      const doc = app.activeDocument;
      if (!doc || !doc.isValid) return { open: false };
      const prefs = doc.documentPreferences;
      return {
        open: true,
        name: doc.name,
        path: doc.fullName?.nativePath || doc.fullName || null,
        saved: doc.saved,
        modified: doc.modified,
        pages: doc.pages.length,
        spreads: doc.spreads.length,
        pageWidth: prefs.pageWidth,
        pageHeight: prefs.pageHeight,
        facingPages: prefs.facingPages,
        units: {
          horizontal: String(doc.viewPreferences.horizontalMeasurementUnits),
          vertical: String(doc.viewPreferences.verticalMeasurementUnits)
        },
        stories: doc.stories.length,
        links: doc.links.length,
        activePage: app.layoutWindows.length ? app.activeWindow?.activePage?.name ?? null : null
      };
    }

    case "selection.get": {
      const selection = selectionArray();
      if (!selection) return { selection: [] };
      return {
        selection: selection.slice(0, Number(args.limit) || 10).map((item, index) => ({
          index,
          kind: kindOf(item),
          label: item.label || null,
          text: limit(textOfSelection(item, args), args.maxChars),
          altText: item.objectExportOptions ? item.objectExportOptions.customAltText || "" : null
        }))
      };
    }

    case "selection.set": {
      const selection = selectionArray();
      if (!selection) throw new Error("Nothing is selected.");
      if (typeof args.text !== "string") throw new Error("Argument [text] must be a string.");
      const done = writeSelection(selection[0], args.text, args);
      if (!done) throw new Error("The current selection cannot take text.");
      return { written: args.text.length };
    }

    case "frames.list": {
      if (app.documents.length === 0) return { frames: [] };
      const doc = app.activeDocument;
      const source = args.scope === "page" && app.layoutWindows.length && app.activeWindow?.activePage
        ? app.activeWindow.activePage
        : (app.activeWindow?.activeSpread ?? doc.spreads.firstItem());
      const frames = source.textFrames;
      const limitCount = Number(args.limit) > 0 ? Number(args.limit) : 25;
      const out = [];
      const count = Math.min(frames.length, limitCount);
      for (let i = 0; i < count; i += 1) {
        const frame = frames.item(i);
        if (!frame || !frame.isValid) continue;
        out.push({
          index: i,
          name: frame.name || null,
          label: frame.label || null,
          text: limit(frame.contents, args.maxChars)
        });
      }
      return { scope: kindOf(source), count: frames.length, returned: out.length, frames: out };
    }

    case "frame.set": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      const doc = app.activeDocument;
      let frame = null;
      if (args.name) {
        frame = doc.textFrames.itemByName(String(args.name));
      } else if (args.label) {
        frame = doc.textFrames.item(String(args.label));
      } else if (Number.isInteger(Number(args.index))) {
        frame = doc.textFrames.item(Number(args.index));
      }
      if (!frame || !frame.isValid) throw new Error("Text frame not found.");
      if (typeof args.text !== "string") throw new Error("Argument [text] must be a string.");
      frame.contents = args.text;
      return { name: frame.name || null, written: args.text.length };
    }

    case "text.append": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      if (typeof args.text !== "string") throw new Error("Argument [text] must be a string.");
      const doc = app.activeDocument;
      const story = args.storyIndex !== undefined ? doc.stories.item(Number(args.storyIndex)) : doc.stories.firstItem();
      if (!story || !story.isValid) throw new Error("Story not found.");
      story.insertionPoints.lastItem().contents = args.text;
      return { storyIndex: story.index, written: args.text.length };
    }

    case "styles.list": {
      if (app.documents.length === 0) return { paragraphStyles: [], characterStyles: [] };
      const doc = app.activeDocument;
      const names = (collection) => {
        const out = [];
        for (let i = 0; i < collection.length; i += 1) {
          const item = collection.item(i);
          if (item && item.isValid) out.push(item.name);
        }
        return out;
      };
      return {
        paragraphStyles: names(doc.paragraphStyles),
        characterStyles: names(doc.characterStyles)
      };
    }

    case "links.list": {
      if (app.documents.length === 0) return { links: [] };
      const doc = app.activeDocument;
      const limitCount = Number(args.limit) > 0 ? Number(args.limit) : 50;
      const count = Math.min(doc.links.length, limitCount);
      const links = [];
      for (let i = 0; i < count; i += 1) {
        const link = doc.links.item(i);
        links.push({
          index: i,
          name: link.name,
          path: link.filePath || null,
          status: String(link.status),
          linkType: String(link.linkType || "")
        });
      }
      return { count: doc.links.length, links };
    }

    case "doc.export": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      const doc = app.activeDocument;
      const format = String(args.format || "pdf").toLowerCase();
      const { localFileSystem } = uxp.storage;
      const { ExportFormat } = indesign;
      const formatMap = {
        pdf: ExportFormat.PDF_TYPE,
        idml: ExportFormat.IDML_TYPE,
        jpeg: ExportFormat.JPG_TYPE,
        jpg: ExportFormat.JPG_TYPE,
        png: ExportFormat.PNG_TYPE,
        eps: ExportFormat.EPS_TYPE
      };
      if (!Object.hasOwn(formatMap, format)) throw new Error(`Unsupported format [${format}].`);
      return localFileSystem.getEntryWithUrl("plugin-temp:/").then((folder) => {
        if (!folder || !folder.isFolder) throw new Error("The plugin temp folder is not available.");
        const fileName = `${(doc.name || "document").replace(/\.indd$/i, "")}-${Date.now()}.${format === "idml" ? "idml" : format}`;
        return folder.createFile(fileName, { overwrite: true }).then((file) => {
          doc.exportFile(formatMap[format], file, false);
          return { format, path: file.nativePath || fileName, name: fileName };
        });
      });
    }

    default:
      throw new Error(`Unknown command [${op}].`);
  }
}
