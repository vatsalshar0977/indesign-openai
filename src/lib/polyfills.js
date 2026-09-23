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
var polyfills_exports = {};
__export(polyfills_exports, {
  TextDecoder: () => TextDecoder,
  TextEncoder: () => TextEncoder
});
module.exports = __toCommonJS(polyfills_exports);
class TextDecoder {
  constructor() {
  }
  /**
   * Returns a string containing the text decoded with the method of the specific TextDecoder object.
   * @param {Array|Int8Array|Uint8Array} bytes 
   * @returns {String}
   */
  decode(bytes) {
    if (bytes === null || bytes === void 0 || !(bytes instanceof Array || bytes instanceof Int8Array || bytes instanceof Uint8Array)) {
      console.error("Argument [bytes] must be a Array of numbers, Int8Array or Uint8Array!");
      return "";
    }
    var utf8String = Array.from(bytes).map(function(item) {
      return String.fromCharCode(item);
    }).join("");
    return decodeURIComponent(escape(utf8String));
  }
}
class TextEncoder {
  constructor() {
  }
  /**
   * Takes a string as input, and returns a Uint8Array containing UTF-8 encoded text.
   * @param {String} str 
   * @returns {Uint8Array}
   */
  encode(str) {
    if (str === null || str === void 0 || str.constructor !== String) {
      console.error("Argument [str] must be a string!");
      return new Uint8Array();
    }
    var utf8String = unescape(encodeURIComponent(str));
    return new Uint8Array(utf8String.split("").map(function(item) {
      return item.charCodeAt(0);
    }));
  }
}
