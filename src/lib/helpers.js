"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var helpers_exports = {};
__export(helpers_exports, {
  FileObject: () => FileObject,
  FolderObject: () => FolderObject,
  arrayBufferToBase64: () => arrayBufferToBase64,
  base64ToArrayBuffer: () => base64ToArrayBuffer,
  localizeElements: () => localizeElements,
  setLanguage: () => setLanguage
});
module.exports = __toCommonJS(helpers_exports);
var import_i18n = require("./i18n");
const uxp = require("uxp");
function setLanguage(lang = "", targetElem) {
  if (!lang) {
    const locale = uxp.host.locale ?? uxp.host.uiLocale ?? "";
    lang = locale.replace(/[\-_].+$/g, "");
  }
  if (!targetElem) {
    targetElem = document.documentElement;
  }
  targetElem.setAttribute("lang", lang);
  return lang;
}
function localizeElements(targetElem) {
  if (!targetElem) {
    targetElem = document.body;
  }
  const localeElemList = targetElem.querySelectorAll("[data-t]");
  localeElemList.forEach((elem) => {
    const dataTValue = elem.getAttribute("data-t") ?? "";
    let label;
    if (!import_i18n.translationsObj.hasOwnProperty(dataTValue)) {
      label = "labelError";
    } else {
      label = dataTValue;
    }
    const attrMatchArray = label.match(/@(.+)$/);
    if (!!attrMatchArray) {
      const attrName = attrMatchArray[1].toLowerCase();
      elem.setAttribute(attrName, import_i18n.i18n.getMessage(label));
    } else {
      elem.textContent = import_i18n.i18n.getMessage(label);
    }
  });
}
function base64ToArrayBuffer(base64String) {
  if (!base64String || base64String.constructor.name !== "String") {
    throw new Error("Argument [base64String] must be a base64 string!");
  }
  let binaryString = "";
  try {
    binaryString = atob(decodeURIComponent(base64String));
  } catch (err) {
    console.error(err);
  }
  const byteLength = binaryString.length;
  const uint8Arr = new Uint8Array(byteLength);
  for (var i = 0; i < byteLength; i += 1) {
    uint8Arr[i] = binaryString.charCodeAt(i);
  }
  return uint8Arr.buffer;
}
function arrayBufferToBase64(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.constructor.name !== "ArrayBuffer") {
    throw new Error("Argument [arrayBuffer] must be a ArrayBuffer!");
  }
  let binaryString = "";
  const bytes = new Uint8Array(arrayBuffer);
  const byteLength = bytes.length;
  for (let i = 0; i < byteLength; i += 1) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  let base64String = "";
  try {
    base64String = btoa(binaryString);
  } catch (err) {
    console.error(err);
  }
  return base64String;
}
class FileObject {
  #url;
  constructor(url) {
    if (!/^([a-z][a-z0-9\-]*):/i.test(url)) {
      url = "file:" + url;
    }
    this.#url = new URL(url);
  }
  /* URL */
  get url() {
    return this.#url;
  }
  set url(value) {
    throw new Error("Property [url] in read only.");
  }
  /* Local file path */
  get localPath() {
    return this.#url.href;
  }
  set localPath(value) {
    throw new Error("Property [localPath] in read only.");
  }
  /* Name */
  get name() {
    return path.parse(this.localPath).name;
  }
  set name(value) {
    throw new Error("Property [name] in read only.");
  }
  /* Name */
  get base() {
    return path.parse(this.localPath).base;
  }
  set base(value) {
    throw new Error("Property [base] in read only.");
  }
  /* Parent folder path */
  get folderPath() {
    return path.parse(this.localPath).dir;
  }
  set folderPath(value) {
    throw new Error("Property [folderPath] in read only.");
  }
  /* File extension */
  get ext() {
    return path.parse(this.localPath).ext;
  }
  set ext(value) {
    throw new Error("Property [ext] in read only.");
  }
  /* File exists? */
  get isExisting() {
    const { localFileSystem } = uxp.storage;
    return new Promise((resolve, reject) => {
      localFileSystem.getEntryWithUrl(this.localPath).then(() => {
        resolve(true);
      }).catch(() => {
        reject(false);
      });
    });
  }
  set isExisting(value) {
    throw new Error("Property [isExisting] is read only.");
  }
  /**
   * Get file entry object
   * @returns {Entry|null}
   */
  async getFileEntry() {
    const { localFileSystem } = uxp.storage;
    let fileEntry;
    try {
      fileEntry = await localFileSystem.getEntryWithUrl(this.localPath);
    } catch (err) {
    }
    if (!fileEntry || !fileEntry.isFile) {
      return null;
    }
    return fileEntry;
  }
  /**
   * Get array buffer of the file
   * @returns {ArrayBuffer|null}
   */
  async getArrayBuffer() {
    const { formats } = uxp.storage;
    const fileEntry = await this.getFileEntry();
    if (!fileEntry) {
      return null;
    }
    let entryArrayBuffer;
    try {
      entryArrayBuffer = await fileEntry.read({ format: formats.binary });
    } catch (err) {
      console.error(err);
    }
    if (!entryArrayBuffer || !(entryArrayBuffer instanceof ArrayBuffer)) {
      return null;
    }
    return entryArrayBuffer;
  }
  /**
   * Get array buffer of the file
   * @returns {string|null}
   */
  async getText() {
    const { formats } = uxp.storage;
    const fileEntry = await this.getFileEntry();
    if (!fileEntry) {
      return "";
    }
    let entryText;
    try {
      entryText = await fileEntry.read({ format: formats.utf8 });
    } catch (err) {
      console.error(err);
    }
    if (!entryText || typeof entryText !== "string") {
      return "";
    }
    return entryText;
  }
  /**
   * Get parent folder
   * @returns {Entry|null}
   */
  async getParentFolder() {
    const { localFileSystem } = uxp.storage;
    let folderEntry;
    try {
      folderEntry = await localFileSystem.getEntryWithUrl(this.folderPath);
    } catch (err) {
    }
    if (!folderEntry || !folderEntry.isFolder) {
      return null;
    }
    return folderEntry;
  }
}
class FolderObject {
  #url;
  constructor(url) {
    if (!/^([a-z][a-z0-9\-]*):/i.test(url)) {
      url = "file:" + url;
    }
    this.#url = new URL(url);
  }
  /* URL */
  get url() {
    return this.#url;
  }
  set url(value) {
    throw new Error("Property [url] in read only.");
  }
  /* URL */
  get localPath() {
    return this.#url.href;
  }
  set localPath(value) {
    throw new Error("Property [localPath] in read only.");
  }
  /* Name */
  get name() {
    return path.parse(this.localPath).name;
  }
  set name(value) {
    throw new Error("Property [name] in read only.");
  }
  /* Folder exists? */
  get isExisting() {
    const { localFileSystem } = uxp.storage;
    return new Promise((resolve, reject) => {
      localFileSystem.getEntryWithUrl(this.localPath).then(() => {
        resolve(true);
      }).catch(() => {
        resolve(false);
      });
    });
  }
  set isExisting(value) {
    throw new Error("Property [isExisting] is read only.");
  }
  /**
   * Get Folder entry object
   * @returns {Entry|null}
   */
  async getFolderEntry() {
    const { localFileSystem } = uxp.storage;
    let folderEntry;
    try {
      folderEntry = await localFileSystem.getEntryWithUrl(this.localPath);
    } catch (err) {
    }
    if (!folderEntry || !folderEntry.isFolder) {
      return null;
    }
    return folderEntry;
  }
}
