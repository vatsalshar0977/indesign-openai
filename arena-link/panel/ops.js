"use strict";

/**
 * InDesign operations the agent is allowed to run.
 *
 * Every op is a fixed case in dispatch() - no eval, no arbitrary scripts. Results are
 * plain JSON-serialisable objects so they can travel back over the bridge.
 */

const indesign = require("indesign");
const uxp = require("uxp");

const DEFAULT_TEXT_LIMIT = 6000;

let lastResult = null;
let lastError = null;

/** Runs a command in the InDesign script context (one undo step, full DOM access). */
function run(command) {
  const { app, ScriptLanguage, UndoModes } = indesign;
  if (!app) throw new Error("InDesign is not available.");
  lastResult = null;
  lastError = null;
  app.doScript(
    executeInside,
    ScriptLanguage.UXPSCRIPT,
    [command],
    UndoModes.ENTIRE_SCRIPT,
    `Arena: ${command?.op || "command"}`
  );
  if (lastError) throw new Error(lastError);
  return lastResult === undefined ? null : lastResult;
}

/* Inside doScript(): no closures, arguments only. */
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

/* ------------------------------------------------------------------ helpers */

function limit(text, max) {
  const value = text === undefined || text === null ? "" : String(text);
  const maxChars = Number(max) > 0 ? Number(max) : DEFAULT_TEXT_LIMIT;
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}… [truncated, ${value.length} chars total]`;
}

function kindOf(item) {
  return item ? item.constructor?.name || typeof item : "none";
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

function textOfSelection(selection, args) {
  const contents = selection.contents;
  if (contents === undefined || contents === null) return "";
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") return String(contents);
  if (contents instanceof Array && "rows" in selection && "columns" in selection) {
    const columnSeparator = args?.columnSeparator || "|";
    const rowSeparator = args?.rowSeparator || "\n";
    const columnCount = selection.columns.length;
    const rowCount = selection.rows.length;
    const rows = [];
    for (let r = 0; r < rowCount; r += 1) rows.push(contents.slice(r * columnCount, (r + 1) * columnCount).join(columnSeparator));
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
    if (selection.constructor.name === "Cell") table = selection.parent;
    if (table.constructor.name !== "Table") return false;
    const firstColumn = selection.columns.firstItem();
    const firstRow = selection.rows.firstItem();
    if (!firstColumn.isValid || !firstRow.isValid) return false;
    const columnCount = selection.columns.length;
    const rowCount = selection.rows.length;
    const splitRegExp = new RegExp(`[${columnSeparator}${rowSeparator === "\\n" ? "\n" : rowSeparator}]+`, "i");
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

function activeSpreadOrPage(args) {
  const { app } = indesign;
  if (args?.scope === "page" && app.layoutWindows.length && app.activeWindow?.activePage) return app.activeWindow.activePage;
  return app.activeWindow?.activeSpread || (app.documents.length ? app.activeDocument.spreads.firstItem() : null);
}

function clearFindPreferences() {
  const { app, NothingEnum } = indesign;
  try {
    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;
    app.findGrepPreferences = NothingEnum.NOTHING;
    app.changeGrepPreferences = NothingEnum.NOTHING;
  } catch (err) {
    /* older builds may not expose all of these */
  }
}

/* ------------------------------------------------------------------ dispatch */

function dispatch(command) {
  const { app } = indesign;
  const op = String(command?.op || "");
  const args = command?.args || {};

  switch (op) {
    case "ping":
      return { app: app.name, version: app.version, documents: app.documents.length, bridge: "arena" };

    case "app.info": {
      const doc = app.documents.length ? app.activeDocument : null;
      const selection = selectionArray();
      return {
        app: app.name,
        version: app.version,
        documents: app.documents.length,
        activeDocument: doc && doc.isValid ? doc.name : null,
        selection: selection ? selection.slice(0, 5).map((item) => kindOf(item)) : []
      };
    }

    case "doc.list": {
      const docs = [];
      for (let i = 0; i < app.documents.length; i += 1) {
        const doc = app.documents.item(i);
        if (!doc || !doc.isValid) continue;
        docs.push({ index: i, name: doc.name, path: safePath(doc), pages: doc.pages.length, saved: doc.saved, active: doc === app.activeDocument });
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
        path: safePath(doc),
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
        activePage: app.layoutWindows.length && app.activeWindow?.activePage ? app.activeWindow.activePage.name : null,
        activeSpread: app.activeWindow?.activeSpread ? app.activeWindow.activeSpread.name || null : null
      };
    }

    case "page.info": {
      if (app.documents.length === 0 || !app.layoutWindows.length) return { open: false };
      const page = app.activeWindow.activePage;
      if (!page || !page.isValid) return { open: false };
      return {
        name: page.name,
        index: page.documentOffset,
        items: page.allPageItems.length,
        textFrames: page.textFrames.length,
        rectangles: page.rectangles.length
      };
    }

    case "selection.get": {
      const selection = selectionArray();
      if (!selection) return { selection: [] };
      return {
        selection: selection.slice(0, Number(args.limit) || 10).map((item, index) => ({
          index,
          kind: kindOf(item),
          name: item.name || null,
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
      if (!writeSelection(selection[0], args.text, args)) throw new Error("The current selection cannot take text.");
      return { written: args.text.length };
    }

    case "frames.list": {
      if (app.documents.length === 0) return { frames: [] };
      const source = activeSpreadOrPage(args);
      if (!source) return { frames: [] };
      const frames = source.textFrames;
      const limitCount = Number(args.limit) > 0 ? Number(args.limit) : 25;
      const count = Math.min(frames.length, limitCount);
      const out = [];
      for (let i = 0; i < count; i += 1) {
        const frame = frames.item(i);
        if (!frame || !frame.isValid) continue;
        out.push({ index: i, name: frame.name || null, label: frame.label || null, text: limit(frame.contents, args.maxChars) });
      }
      return { scope: kindOf(source), count: frames.length, returned: out.length, frames: out };
    }

    case "frame.set": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      const doc = app.activeDocument;
      let frame = null;
      if (args.name) frame = doc.textFrames.itemByName(String(args.name));
      else if (args.label) frame = doc.textFrames.item(String(args.label));
      else if (args.index !== undefined && Number.isInteger(Number(args.index))) frame = doc.textFrames.item(Number(args.index));
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

    case "text.find": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      if (!args.find) throw new Error("Argument [find] is required.");
      const { app: appRef } = indesign;
      const doc = appRef.activeDocument;
      clearFindPreferences();
      let found;
      if (args.grep) {
        appRef.findGrepPreferences.findWhat = String(args.find);
        found = doc.findGrep();
      } else {
        appRef.findTextPreferences.findWhat = String(args.find);
        found = doc.findText();
      }
      const limitCount = Number(args.limit) > 0 ? Number(args.limit) : 20;
      const matches = [];
      const count = Math.min(found.length, limitCount);
      for (let i = 0; i < count; i += 1) matches.push(limit(found[i].contents, 300));
      clearFindPreferences();
      return { total: found.length, returned: matches.length, matches };
    }

    case "text.replace": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      if (!args.find) throw new Error("Argument [find] is required.");
      const { app: appRef } = indesign;
      const doc = appRef.activeDocument;
      clearFindPreferences();
      let changed;
      if (args.grep) {
        appRef.findGrepPreferences.findWhat = String(args.find);
        appRef.changeGrepPreferences.changeTo = String(args.replace ?? "");
        changed = doc.changeGrep();
      } else {
        appRef.findTextPreferences.findWhat = String(args.find);
        appRef.changeTextPreferences.changeTo = String(args.replace ?? "");
        changed = doc.changeText();
      }
      clearFindPreferences();
      return { replaced: changed.length, find: String(args.find), replace: String(args.replace ?? "") };
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
      return { paragraphStyles: names(doc.paragraphStyles), characterStyles: names(doc.characterStyles) };
    }

    case "links.list": {
      if (app.documents.length === 0) return { links: [] };
      const doc = app.activeDocument;
      const limitCount = Number(args.limit) > 0 ? Number(args.limit) : 50;
      const count = Math.min(doc.links.length, limitCount);
      const links = [];
      for (let i = 0; i < count; i += 1) {
        const link = doc.links.item(i);
        links.push({ index: i, name: link.name, path: link.filePath || null, status: String(link.status) });
      }
      return { count: doc.links.length, links };
    }

    case "altText.get": {
      const selection = selectionArray();
      const item = selection && selection[0];
      if (!item || !item.objectExportOptions) throw new Error("Select an image, frame or group first.");
      return { altText: item.objectExportOptions.customAltText || "", kind: kindOf(item), name: item.name || null };
    }

    case "altText.set": {
      const { SourceType } = indesign;
      const selection = selectionArray();
      const item = selection && selection[0];
      if (!item || !item.objectExportOptions) throw new Error("Select an image, frame or group first.");
      if (typeof args.text !== "string") throw new Error("Argument [text] must be a string.");
      item.objectExportOptions.altTextSourceType = SourceType.SOURCE_CUSTOM;
      item.objectExportOptions.customAltText = args.text;
      return { written: args.text.length };
    }

    case "doc.save": {
      if (app.documents.length === 0) throw new Error("No document is open.");
      const doc = app.activeDocument;
      if (args.path) {
        throw new Error("Save-as is not exposed; use doc.save (no arguments) or doc.export.");
      }
      doc.save();
      return { saved: true, path: safePath(doc) };
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
        const base = (doc.name || "document").replace(/\.indd$/i, "");
        const fileName = `${base}-${Date.now()}.${format === "idml" ? "idml" : format}`;
        return folder.createFile(fileName, { overwrite: true }).then((file) => {
          doc.exportFile(formatMap[format], file, false);
          return { format, name: fileName, path: file.nativePath || fileName };
        });
      });
    }

    case "image.get": {
      /* Selected image as a base64 JPEG - lets the agent look at what is on the page. */
      const selection = selectionArray();
      const item = selection && selection[0];
      if (!item) throw new Error("Nothing is selected.");
      const { localFileSystem, formats } = uxp.storage;
      const { ExportFormat } = indesign;
      return localFileSystem.getEntryWithUrl("plugin-temp:/").then((folder) => {
        if (!folder || !folder.isFolder) throw new Error("The plugin temp folder is not available.");
        const fileName = `arena-${Date.now()}.jpg`;
        return folder.createFile(fileName, { overwrite: true }).then(async (file) => {
          item.exportFile(ExportFormat.JPG_TYPE, file, false);
          const arrayBuffer = await file.read({ format: formats.binary });
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          return { name: fileName, path: file.nativePath || fileName, mime: "image/jpeg", bytes: bytes.length, base64: btoa(binary) };
        });
      });
    }

    default:
      throw new Error(`Unknown command [${op}].`);
  }
}

module.exports = { run };
