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
var i18n_exports = {};
__export(i18n_exports, {
  i18n: () => i18n,
  translationsObj: () => translationsObj
});
module.exports = __toCommonJS(i18n_exports);
var import_locales = require("../panel/locales.js");
const DEFAULT_LANG = "en";
const languageCodeObj = {
  "ar": "Arabic",
  "cs": "Czech",
  "da": "Danish",
  "de": "German",
  "en": "English",
  "es": "Spanish",
  "fi": "Finnish",
  "fr": "French",
  "he": "Hebrew",
  "hu": "Hungarian",
  "it": "Italian",
  "ja": "Japanese",
  "ko": "Korean",
  "nl": "Dutch",
  "no": "Norwegian",
  "pl": "Polish",
  "pt": "Portuguese",
  "ru": "Russian",
  "sv": "Swedish",
  "tr": "Turkish",
  "uk": "Ukrainian",
  "zh": "Chinese"
};
const translationsObj = {
  ...import_locales.localeObj
};
const i18n = {
  translations: translationsObj,
  getMessage(label, ...args) {
    if (!this.translations.hasOwnProperty(label)) {
      label = "labelError";
    }
    const PLACEHOLDER_MARKER = "$";
    const argsArray = args.flat();
    let language = this.getUILanguage();
    let languageCode;
    if (languageCodeObj.hasOwnProperty(language) && language !== DEFAULT_LANG) {
      languageCode = language;
    } else {
      languageCode = "default";
    }
    let message = this.translations[label][languageCode] ?? this.translations[label]["default"] ?? "";
    for (let i = 0; i < argsArray.length; i += 1) {
      const mergeRegEx = new RegExp(`\\${PLACEHOLDER_MARKER}` + (i + 1), "ig");
      message = message.replace(mergeRegEx, argsArray[i]);
    }
    return message;
  },
  getAcceptLanguages() {
    return [this.getUILanguage()];
  },
  getUILanguage() {
    const docLang = document.body.getAttribute("xml:lang") || document.body.getAttribute("lang") || document.documentElement.getAttribute("xml:lang") || document.documentElement.getAttribute("lang") || "";
    if (!docLang) {
      return "";
    }
    const localeIdentifier = docLang.replace(/_/g, "-");
    let locale;
    try {
      locale = new Intl.Locale(localeIdentifier);
    } catch (err) {
      console.error(err);
      return "";
    }
    const language = locale.language;
    if (language.constructor !== String) {
      return "";
    }
    return language;
  }
};
