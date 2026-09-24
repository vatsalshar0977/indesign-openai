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
var create_exports = {};
__export(create_exports, {
  cleanup: () => cleanup,
  setup: () => setup
});
module.exports = __toCommonJS(create_exports);
var import_i18n = require("../lib/i18n");
var import_polyfills = require("../lib/polyfills");
var import_helpers = require("../lib/helpers.js");
var import_dialogs = require("../lib/dialogs.js");
var import_config = require("../lib/config.js");
var import_bridge = require("./bridge.js");
const uxp = require("uxp");
const indesign = require("indesign");
const TABLE_ROW_SEPARATOR = "\n";
const TABLE_COLUMN_SEPARATOR = "|";
const NEW_LINE_CHARS = "\n\r";
const OPTIONAL_TEXT_MARKER = '"""';
const DEFAULT_API_KEY_NAME = "openai-api-key";
const DEFAULT_API_URL = "https://api.openai.com";
/* Agent mode: the request goes to the Arena bridge and is answered by the agent. */
const AGENT_MODEL = "arena-agent";
const AGENT_IMAGE_MODEL = "arena-agent-image";
const AGENT_PLACEHOLDER_KEY = "arena-bridge";
/* Some reverse proxies in front of the bridge reject non-browser clients with 403. */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getSelectedModel() {
  const modelDropdownElem = document.getElementById("model-dropdown");
  return modelDropdownElem?.value || AGENT_MODEL;
}
function isAgentModel(model) {
  return model === AGENT_MODEL || model === AGENT_IMAGE_MODEL;
}
class State {
  tableRowSeparator = TABLE_ROW_SEPARATOR;
  tableColumnSeparator = TABLE_COLUMN_SEPARATOR;
  newLineChars = NEW_LINE_CHARS;
  optionalTextMarker = OPTIONAL_TEXT_MARKER;
  #choices = [];
  #index = -1;
  apiKeyName = DEFAULT_API_KEY_NAME;
  /* The endpoint follows the configured bridge URL - the state object is frozen. */
  get baseURL() {
    return import_config.getBridgeUrl() || DEFAULT_API_URL;
  }
  set baseURL(value) {
  }
  constructor() {
  }
  get choices() {
    return this.#choices;
  }
  set choices(arr) {
    if (!arr || !(arr instanceof Array)) {
      arr = [];
    }
    this.#choices = arr;
  }
  get index() {
    return this.#index;
  }
  set index(i) {
    if (!i || i.constructor !== Number || isNaN(i) || i < 0) {
      this.#index = 0;
    } else if (i >= this.choices.length) {
      this.#index = this.choices.length - 1;
    } else {
      this.#index = i;
    }
  }
  get length() {
    return this.#choices.length;
  }
}
;
async function setup(rootNode) {
  const state = new State();
  Object.freeze(state);
  (0, import_helpers.setLanguage)();
  (0, import_helpers.localizeElements)();
  const handlerConfigArray = [
    { "id": "model-dropdown", "event": "change", "handler": modelDropdownChangeHandler },
    { "id": "api-key-button", "event": "click", "handler": apiKeyButtonClickHandler },
    { "id": "bridge-url-button", "event": "click", "handler": bridgeUrlButtonClickHandler },
    { "id": "agent-link-switch", "event": "change", "handler": agentLinkSwitchChangeHandler },
    { "id": "instruction-clear-button", "event": "click", "handler": clearButtonClickHandler },
    { "id": "optional-input-clear-button", "event": "click", "handler": clearButtonClickHandler },
    { "id": "optional-input-import-button", "event": "click", "handler": importButtonClickHandler },
    { "id": "send-button", "event": "click", "handler": sendButtonClickHandler },
    { "id": "transfer-result-button", "event": "click", "handler": transferResultButtonClickHandler },
    { "id": "insert-button", "event": "click", "handler": insertButtonClickHandler },
    { "id": "prev-choice-button", "event": "click", "handler": prevChoiceButtonClickHandler },
    { "id": "next-choice-button", "event": "click", "handler": nextChoiceButtonClickHandler },
    { "id": "clipboard-button", "event": "click", "handler": clipboardButtonClickHandler }
  ];
  registerPanelEventHandlers(handlerConfigArray, state);
  updateAgentMode(state);
  registerAppEventHandler();
  setInitialPanelValues();
  resetNavi();
  initAgentLink(state);
  return true;
}
function registerPanelEventHandlers(handlerConfigArray, state) {
  handlerConfigArray.forEach((item) => {
    const handlerElem = document.getElementById(item.id ?? "") || document.querySelector(item.query ?? "");
    handlerElem?.addEventListener(item.event, (evt) => {
      item.handler(evt, state);
    });
  });
  return true;
}
function registerAppEventHandler() {
  const modelDropdownElem = document.getElementById("model-dropdown");
  const openAIModel = modelDropdownElem.value;
  switch (openAIModel) {
    case "gpt-4-vision":
    case "arena-agent-image":
      indesign?.app?.addEventListener("afterSelectionChanged", afterSelectionChangedHandler);
      break;
    default:
  }
}
function removeAppEventHandler() {
  const modelDropdownElem = document.getElementById("model-dropdown");
  const openAIModel = modelDropdownElem.value;
  switch (openAIModel) {
    case "gpt-4-vision":
    case "arena-agent-image":
      break;
    default:
      indesign?.app?.removeEventListener("afterSelectionChanged", afterSelectionChangedHandler);
  }
}
function afterSelectionChangedHandler(evt) {
  setInitialOptionalText();
}
async function sendButtonClickHandler(evt, state) {
  const modelDropdownElem = document.getElementById("model-dropdown");
  const openAIModel = modelDropdownElem.value;
  const isAgentMode = isAgentModel(openAIModel);
  let baseURL = state.baseURL;
  if (isAgentMode) {
    /* Agent mode: no OpenAI account, no API key - the bridge answers. */
    baseURL = import_config.getBridgeUrl();
    if (!baseURL) {
      setErrorMessage("Set the Arena bridge URL first (link icon next to the key icon).");
      return false;
    }
  }
  let savedApiKey = await getApiKey(state.apiKeyName);
  if (!savedApiKey && isAgentMode) {
    /* The bridge does its own authentication - a placeholder key is enough. */
    savedApiKey = AGENT_PLACEHOLDER_KEY;
  }
  if (!savedApiKey) {
    setErrorMessage(import_i18n.i18n.getMessage("noApiKeyInfoMessage"));
    return false;
  }
  const nSlicerElem = document.getElementById("n-slider");
  const n = parseInt(nSlicerElem.value);
  const temperatureSlicerElem = document.getElementById("temperature-slider");
  const temperature = parseFloat(temperatureSlicerElem.value);
  const instructionTextareaElem = document.getElementById("instruction-textarea");
  instructionTextareaElem.removeAttribute("invalid");
  const instructionText = instructionTextareaElem.value;
  const opionalInputTextareaElem = document.getElementById("optional-input-textarea");
  const editText = opionalInputTextareaElem.value || "";
  clearErrorMessage();
  if (instructionTextareaElem.value === "") {
    instructionTextareaElem.setAttribute("invalid", "");
    setErrorMessage(import_i18n.i18n.getMessage("emptyInstructionTextareaErrorMessage"));
    return false;
  }
  if (!navigator.onLine) {
    setErrorMessage(import_i18n.i18n.getMessage("noNetworkErrorMessage"));
    return false;
  }
  const { endpoint, sendDataObj } = await getDataForRequest(openAIModel, editText, instructionText, temperature, n, state) ?? {};
  if (!endpoint || !sendDataObj) {
    setErrorMessage(import_i18n.i18n.getMessage("noRequestDataErrorMessage"));
    return false;
  }
  let sendData;
  try {
    sendData = JSON.stringify(sendDataObj);
  } catch (err) {
    setErrorMessage(err);
    return false;
  }
  const sendButtonElem = document.getElementById("send-button");
  sendButtonElem.setAttribute("disabled", "");
  const outputContentGroupElem = document.getElementById("output-content-group");
  outputContentGroupElem.classList.add("hidden");
  const outputTextareaElem = document.getElementById("output-textarea");
  outputTextareaElem.value = "";
  const spinnerContainerElem = document.getElementById("spinner-group");
  spinnerContainerElem.classList.remove("hidden");
  state.choices = [];
  state.index = 0;
  let resultDataObj;
  try {
    resultDataObj = await send(endpoint, sendData, "POST", savedApiKey, state, baseURL);
  } catch (err) {
    setErrorMessage(err);
    return false;
  } finally {
    sendButtonElem.removeAttribute("disabled");
    spinnerContainerElem.classList.add("hidden");
    outputContentGroupElem.classList.remove("hidden");
  }
  if (!resultDataObj) {
    setErrorMessage(import_i18n.i18n.getMessage("failedRequestErrorMessage"));
    return false;
  }
  if (Object.hasOwn(resultDataObj, "error") && !!resultDataObj.error) {
    setErrorMessage(resultDataObj?.error?.message || import_i18n.i18n.getMessage("failedRequestErrorMessage"));
    return false;
  }
  const cleanTextRegExp = new RegExp(`(^\\s*${state.optionalTextMarker})|(${state.optionalTextMarker}\\s*$)`, "ig");
  if (Object.hasOwn(resultDataObj, "choices")) {
    const dataChoiceArray = resultDataObj.choices;
    dataChoiceArray.forEach((item) => {
      const itemText = item?.text || item?.message?.content;
      if (!!itemText) {
        const cleanedText = itemText.replace(cleanTextRegExp, "");
        state.choices.push(cleanedText);
      }
    });
  } else if (Object.hasOwn(resultDataObj, "output")) {
    const outputArray = resultDataObj.output instanceof Array ? resultDataObj.output : [];
    const messageItem = outputArray.find((item) => !!item?.content?.[0]?.text) || outputArray[1];
    const contentArray = messageItem?.content instanceof Array ? messageItem.content : [];
    contentArray.forEach((contentItem) => {
      const itemText = contentItem?.text || "";
      if (!!itemText) {
        const cleanedText = itemText.replace(cleanTextRegExp, "");
        state.choices.push(cleanedText);
      }
    });
  } else {
    setErrorMessage(import_i18n.i18n.getMessage("failedRequestErrorMessage"));
    return false;
  }
  outputTextareaElem.value = state.choices[state.index] || "";
  setNavi(state);
  clearErrorMessage();
  return true;
}
function setInitialPanelValues() {
  setInitialOptionalText();
  setInitialInstructionText();
}
function setInitialInstructionText() {
  const modelDropdownElem = document.getElementById("model-dropdown");
  const opionalInputTextareaElem = document.getElementById("optional-input-textarea");
  const instructionTextareaElem = document.getElementById("instruction-textarea");
  const openAIModel = modelDropdownElem.value;
  switch (openAIModel) {
    case "gpt-4-vision":
    case "arena-agent-image":
      let instruction = import_i18n.i18n.getMessage("imageDescriptionDefaultInstruction");
      if (opionalInputTextareaElem.value !== "") {
        instruction += " " + import_i18n.i18n.getMessage("instructionAdditionForExistingAltText");
      }
      instructionTextareaElem.value = instruction;
      break;
  }
}
function setInitialOptionalText() {
  const modelDropdownElem = document.getElementById("model-dropdown");
  const opionalInputTextareaElem = document.getElementById("optional-input-textarea");
  const openAIModel = modelDropdownElem.value;
  switch (openAIModel) {
    case "gpt-4-vision":
    case "arena-agent-image":
      const altTextItem = getAltTextItem();
      if (!altTextItem) {
        break;
      }
      const customAltText = altTextItem?.objectExportOptions?.customAltText;
      if (!customAltText) {
        opionalInputTextareaElem.value = "";
      } else {
        opionalInputTextareaElem.value = customAltText;
      }
      break;
  }
}
function getAltTextItem() {
  const { app } = indesign;
  if (app.documents.length === 0 || app.layoutWindows.length === 0) {
    return null;
  }
  const selectionArray = app.properties.selection;
  if (!selectionArray || !(selectionArray instanceof Array) || selectionArray.length === 0) {
    return null;
  }
  let firstSelection = selectionArray[0];
  if (!firstSelection || !Reflect.has(firstSelection, "isValid") || !firstSelection.isValid) {
    return null;
  }
  if (Reflect.has(firstSelection, "objectExportOptions")) {
    return firstSelection;
  }
  const parentItem = firstSelection.parent;
  if (Reflect.has(parentItem, "objectExportOptions")) {
    return parentItem;
  }
  return null;
}
async function getDataForRequest(openAIModel, editText = "", instructionText = "", temperature = 0.7, n = 1, state) {
  if (openAIModel === "") {
    console.warn("Argument [openAIModel] must be a non-empty string.", openAIModel);
    return null;
  }
  if (temperature < 0 || temperature > 2) {
    console.warn("Argument [temperature] must be a number between 0 and 2.", temperature);
    return null;
  }
  if (n < 1) {
    console.warn("Argument [n] must be a positiv number.", n);
    return null;
  }
  let endpoint;
  let sendDataObj;
  switch (openAIModel) {
    /* Arena agent: no OpenAI model, the bridge queues the request for the agent. */
    case "arena-agent":
    case "arena-agent-image":
      let agentMessageContent = instructionText.trim();
      if (editText.trim() !== "") {
        agentMessageContent = agentMessageContent.replace(/[:]$/, "") + ": " + state.optionalTextMarker + editText + state.optionalTextMarker;
      }
      endpoint = "v1/chat/completions";
      if (openAIModel === AGENT_IMAGE_MODEL) {
        const agentImageBase64 = await getSelectedItemAsBase64();
        if (!agentImageBase64) {
          setErrorMessage(import_i18n.i18n.getMessage("noImageUrlErrorMessage"));
          return null;
        }
        sendDataObj = {
          "model": AGENT_MODEL,
          "messages": [{
            "role": "user",
            "content": [
              { "type": "text", "text": agentMessageContent },
              { "type": "image_url", "image_url": { "url": agentImageBase64 } }
            ]
          }],
          "temperature": temperature,
          "n": n,
          "max_tokens": 1e3
        };
      } else {
        sendDataObj = {
          "model": AGENT_MODEL,
          "messages": [{ "role": "user", "content": agentMessageContent }],
          "temperature": temperature,
          "n": n
        };
      }
      break;
    /* Chat */
    case "gpt-5":
    case "gpt-5-mini":
    case "o4-mini":
      let gpt5MmessageContent = instructionText.trim();
      if (editText.trim() !== "") {
        gpt5MmessageContent = gpt5MmessageContent.replace(/[:]$/, "") + ": " + state.optionalTextMarker + editText + state.optionalTextMarker;
      }
      endpoint = "v1/responses";
      sendDataObj = {
        "model": openAIModel,
        "input": gpt5MmessageContent
      };
      break;
    case "gpt-4o":
    case "gpt-4-turbo":
    case "gpt-4.1":
    case "gpt-3.5-turbo":
      let messageContent = instructionText.trim();
      if (editText.trim() !== "") {
        messageContent = messageContent.replace(/[:]$/, "") + ": " + state.optionalTextMarker + editText + state.optionalTextMarker;
      }
      endpoint = "v1/chat/completions";
      sendDataObj = {
        "model": openAIModel,
        "messages": [{ "role": "user", "content": messageContent }],
        "temperature": temperature,
        "n": n
      };
      break;
    case "gpt-4-vision":
      const imageUrlBase64 = await getSelectedItemAsBase64();
      if (!imageUrlBase64) {
        setErrorMessage(import_i18n.i18n.getMessage("noImageUrlErrorMessage"));
        return null;
      }
      let messageText = instructionText.trim();
      if (editText.trim() !== "") {
        messageText = messageText.replace(/[:]$/, "") + ": " + state.optionalTextMarker + editText + state.optionalTextMarker;
      }
      endpoint = "v1/chat/completions";
      sendDataObj = {
        "model": "gpt-4o",
        "messages": [{
          "role": "user",
          "content": [
            { "type": "text", "text": messageText },
            { "type": "image_url", "image_url": { "url": imageUrlBase64 } }
          ]
        }],
        "temperature": temperature,
        "n": n,
        "max_tokens": 1e3
      };
      break;
    default:
      console.warn("Model for data request object not correkt.");
      return null;
  }
  return {
    endpoint,
    sendDataObj
  };
}
async function send(endpoint, sendData, method, apiKey, state, baseURL = state.baseURL) {
  if (endpoint === "") {
    throw new Error("Argument [endpoint] must be a not empty string.");
  }
  if (apiKey === "") {
    throw new Error("Argument [apiKey] must be a not empty string.");
  }
  const url = new URL(endpoint, baseURL);
  let headers = new Headers();
  headers.append("Authorization", `Bearer ${apiKey}`);
  headers.append("Accept", "application/json, text/plain, */*");
  headers.append("Accept-Language", "en-US,en;q=0.9");
  headers.append("Cache-Control", "no-cache");
  headers.append("User-Agent", BROWSER_UA);
  if (!!sendData) {
    headers.append("Content-Type", "application/json");
  }
  const request = new Request(url, {
    /* mode: "cors", */
    /* credentials: "include", */
    method,
    headers,
    body: sendData,
    redirect: "follow"
  });
  const response = await fetch(request);
  if (response.status === 202) {
    /* Arena bridge: the request is queued until the agent answers it. */
    const queuedObj = await response.json().catch(() => ({}));
    const jobId = queuedObj?.id || "";
    if (!jobId) {
      throw new Error("The bridge accepted the request but returned no job id.");
    }
    return await waitForJobResult(jobId, apiKey, state, baseURL);
  }
  if (!response.ok) {
    console.log(`${import_i18n.i18n.getMessage("fetchResponseErrorMessage")} Status: ${response.status}`);
    if (response.status === 403) {
      throw new Error("403 from the host in front of the bridge (proxy). Run the bridge locally (link icon → http://localhost:8787) or check the URL.");
    }
  }
  const responseJsonObj = await response.json();
  return responseJsonObj;
}
/**
 * Polls an Arena bridge job until the agent has answered it.
 * The server holds each poll open for up to 20 seconds, so this is quiet.
 */
async function waitForJobResult(jobId, apiKey, state, baseURL = state.baseURL) {
  const spinnerElem = document.getElementById("spinner");
  const spinnerText = spinnerElem ? spinnerElem.textContent : "";
  if (spinnerElem) {
    spinnerElem.textContent = "Waiting for the agent …";
  }
  const url = new URL(`v1/jobs/${jobId}?wait=20`, state.baseURL.replace(/\/+$/, "") + "/");
  const timeoutMs = 15 * 60 * 1e3;
  const startTimestamp = Date.now();
  try {
    while (Date.now() - startTimestamp < timeoutMs) {
      const pollHeaders = new Headers();
      pollHeaders.append("Authorization", `Bearer ${apiKey}`);
      pollHeaders.append("Accept", "application/json, text/plain, */*");
      pollHeaders.append("Accept-Language", "en-US,en;q=0.9");
      pollHeaders.append("User-Agent", BROWSER_UA);
      const request = new Request(url, {
        method: "GET",
        headers: pollHeaders,
        redirect: "follow"
      });
      const response = await fetch(request);
      if (response.ok) {
        const jobObj = await response.json().catch(() => ({}));
        if (jobObj.state === "done" && !!jobObj.result) {
          return jobObj.result;
        }
        if (jobObj.state === "error") {
          throw new Error(jobObj.error || "The agent could not answer this request.");
        }
        if (jobObj.state === "cancelled") {
          throw new Error("The request was cancelled.");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    if (spinnerElem) {
      spinnerElem.textContent = spinnerText;
    }
  }
  throw new Error("Timed out waiting for the agent (15 min).");
}
function modelDropdownChangeHandler(evt, state) {
  updateAgentMode(state);
  setNavi(state);
  clearErrorMessage();
  registerAppEventHandler();
  removeAppEventHandler();
  setInitialPanelValues();
}
/**
 * Small helper - some UXP builds do not support classList.toggle(..., force).
 */
function setClass(elem, className, isSet) {
  if (!elem || !elem.classList) return false;
  if (isSet) {
    elem.classList.add(className);
  } else {
    elem.classList.remove(className);
  }
  return true;
}
/**
 * Agent mode needs no model settings and no API key, so those controls are hidden.
 */
function updateAgentMode(state) {
  const isAgentMode = isAgentModel(getSelectedModel());
  const settingsGroupElem = document.getElementById("settings-group");
  const apiKeyButtonElem = document.getElementById("api-key-button");
  setClass(settingsGroupElem, "display-none", isAgentMode);
  setClass(apiKeyButtonElem, "display-none", isAgentMode);
  const instructionTextareaElem = document.getElementById("instruction-textarea");
  if (instructionTextareaElem && isAgentMode) {
    instructionTextareaElem.setAttribute("placeholder", "Ask the agent …");
  }
  return isAgentMode;
}
async function apiKeyButtonClickHandler(evt, state) {
  if ("altKey" in evt && evt.altKey) {
    removeApiKey(state.apiKeyName);
    return;
  }
  const savedApiKey = await getApiKey(state.apiKeyName);
  const dialog = new import_dialogs.CustomPrompt();
  const enteredApiKey = await dialog.show({
    headline: import_i18n.i18n.getMessage("apiKeyPromptHeadline"),
    message: import_i18n.i18n.getMessage("apiKeyPromptMessage"),
    "defaultValue": savedApiKey
  });
  if (!enteredApiKey) {
    return;
  }
  await setApiKey(state.apiKeyName, enteredApiKey);
}
async function setApiKey(apiKeyName, apiKeyValue) {
  if (apiKeyName === "" || apiKeyValue === "") {
    return;
  }
  const secureStorage = uxp.storage.secureStorage;
  try {
    await secureStorage.setItem(apiKeyName, apiKeyValue);
  } catch (err) {
    console.info(import_i18n.i18n.getMessage("apiKeySetInfoMessage", [apiKeyValue, apiKeyName]));
  }
}
async function getApiKey(apiKeyName) {
  if (apiKeyName === "") {
    return "";
  }
  const secureStorage = uxp.storage.secureStorage;
  const textDecoder = new import_polyfills.TextDecoder();
  let apiKeyValue = "";
  try {
    const valueUint8Array = await secureStorage.getItem(apiKeyName);
    apiKeyValue = textDecoder.decode(valueUint8Array);
  } catch (err) {
    console.info(import_i18n.i18n.getMessage("apiKeyGetInfoMessage", apiKeyName));
  }
  return apiKeyValue;
}
async function removeApiKey(apiKeyName) {
  if (apiKeyName === "") {
    return;
  }
  const secureStorage = uxp.storage.secureStorage;
  try {
    await secureStorage.removeItem(apiKeyName);
  } catch (err) {
    console.info(import_i18n.i18n.getMessage("removeApiKeyErrorMessage", apiKeyName));
  }
}
function clipboardButtonClickHandler(evt, state) {
  const outputTextareaElem = document.getElementById("output-textarea");
  const textareaValue = outputTextareaElem.value;
  const selectionStart = outputTextareaElem.selectionStart;
  const selectionEnd = outputTextareaElem.selectionEnd;
  let clipboardText = textareaValue;
  if (selectionStart !== selectionEnd) {
    clipboardText = textareaValue.substring(selectionStart, selectionEnd);
  }
  navigator.clipboard.setContent({
    "text/plain": clipboardText
  });
}
function clearButtonClickHandler(evt, state) {
  if (!evt.currentTarget) {
    return;
  }
  const currentTarget = evt.currentTarget;
  if (!(currentTarget instanceof HTMLElement)) {
    return;
  }
  const textareaElem = currentTarget?.parentElement?.parentElement?.querySelector("sp-textarea");
  if (!textareaElem) {
    return;
  }
  textareaElem.value = "";
}
function importButtonClickHandler(evt, state) {
  const optionalInputTextareaElem = document.getElementById("optional-input-textarea");
  const selectedText = getSelectedTextContents(state.tableColumnSeparator, state.tableRowSeparator);
  optionalInputTextareaElem.value = selectedText.toString();
}
function transferResultButtonClickHandler(evt, state) {
  const outputTextareaElemTextareaElem = document.getElementById("output-textarea");
  const optionalInputTextareaElem = document.getElementById("optional-input-textarea");
  optionalInputTextareaElem.value = outputTextareaElemTextareaElem.value;
  outputTextareaElemTextareaElem.value = "";
}
function prevChoiceButtonClickHandler(evt, state) {
  const outputTextareaElem = document.getElementById("output-textarea");
  state.index -= 1;
  outputTextareaElem.value = state.choices[state.index];
  setNavi(state);
}
function nextChoiceButtonClickHandler(evt, state) {
  const outputTextareaElem = document.getElementById("output-textarea");
  state.index += 1;
  outputTextareaElem.value = state.choices[state.index];
  setNavi(state);
}
function insertButtonClickHandler(evt, state) {
  const { app, ScriptLanguage, UndoModes, SourceType } = indesign;
  const outputTextareaElem = document.getElementById("output-textarea");
  const modelDropdownElem = document.getElementById("model-dropdown");
  const textareaValue = outputTextareaElem.value;
  const selectionStart = outputTextareaElem.selectionStart;
  const selectionEnd = outputTextareaElem.selectionEnd;
  const openAIModel = modelDropdownElem.value;
  let outputText = textareaValue;
  if (selectionStart !== selectionEnd) {
    outputText = textareaValue.substring(selectionStart, selectionEnd);
  }
  switch (openAIModel) {
    /* Object Export Options: Custom Alt Text */
    case "gpt-4-vision":
      const altTextItem = getAltTextItem();
      if (!altTextItem || !Reflect.has(altTextItem, "objectExportOptions")) {
        break;
      }
      try {
        altTextItem.objectExportOptions.altTextSourceType = SourceType.SOURCE_CUSTOM;
        altTextItem.objectExportOptions.customAltText = outputText;
      } catch (err) {
        console.error(err);
      }
      break;
    default:
      try {
        app.doScript(
          placeText,
          ScriptLanguage.UXPSCRIPT,
          [outputText, state.tableColumnSeparator, state.newLineChars],
          UndoModes.ENTIRE_SCRIPT,
          import_i18n.i18n.getMessage("placeTextUndoLabel")
        );
      } catch (err) {
        console.error(err);
      }
  }
}
function setNavi(state) {
  const prevChoiceButtonElem = document.getElementById("prev-choice-button");
  if (state.index > 0) {
    prevChoiceButtonElem.classList.remove("hidden");
  } else {
    prevChoiceButtonElem.classList.add("hidden");
  }
  const nextChoiceButtonElem = document.getElementById("next-choice-button");
  if (state.length > 1 && state.index > -1 && state.index < state.length - 1) {
    nextChoiceButtonElem.classList.remove("hidden");
  } else {
    nextChoiceButtonElem.classList.add("hidden");
  }
  const currentChoiceElem = document.getElementById("current-choice");
  currentChoiceElem.textContent = "" + (state.index + 1);
  const choiceLabelSeparatorElem = document.getElementById("choice-label-separator");
  choiceLabelSeparatorElem.textContent = "/";
  const numberOfChoicesElem = document.getElementById("number-of-choices");
  numberOfChoicesElem.textContent = "" + state.length;
}
function resetNavi() {
  const prevChoiceButtonElem = document.getElementById("prev-choice-button");
  prevChoiceButtonElem.classList.add("hidden");
  const nextChoiceButtonElem = document.getElementById("next-choice-button");
  nextChoiceButtonElem.classList.add("hidden");
  const currentChoiceElem = document.getElementById("current-choice");
  currentChoiceElem.textContent = "0";
  const choiceLabelSeparatorElem = document.getElementById("choice-label-separator");
  choiceLabelSeparatorElem.textContent = "/";
  const numberOfChoicesElem = document.getElementById("number-of-choices");
  numberOfChoicesElem.textContent = "0";
}
function clearErrorMessage() {
  const errorMessageElem = document.getElementById("input-error-message");
  if (!errorMessageElem || !("textContent" in errorMessageElem)) {
    return false;
  }
  errorMessageElem.classList.remove("active");
  errorMessageElem.textContent = "";
  return true;
}
function setErrorMessage(err) {
  if (err === void 0 || err === null) {
    return false;
  }
  console.error(err);
  const errorMessageElem = document.getElementById("input-error-message");
  if (!errorMessageElem || !(errorMessageElem instanceof HTMLElement)) {
    return false;
  }
  let message;
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  } else if ("toString" in err) {
    message = err.toString();
  } else {
    message = import_i18n.i18n.getMessage("unknownErrorLabel");
  }
  errorMessageElem.textContent = errorMessageElem.textContent + " " + message;
  errorMessageElem.classList.add("active");
  return true;
}
function placeText(args) {
  const [value, tableColumnSeparator, newLineChars] = args;
  if (!value || typeof value !== "string" || !tableColumnSeparator || typeof tableColumnSeparator !== "string" || !newLineChars || typeof newLineChars !== "string") {
    return false;
  }
  const textSelection = getTextSelection();
  if (!textSelection) {
    return false;
  }
  const contents = textSelection.contents;
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") {
    textSelection.contents = value;
    return true;
  }
  if (contents instanceof Array && "rows" in textSelection && "columns" in textSelection) {
    const firstColumn = textSelection.columns.firstItem();
    const firstRow = textSelection.rows.firstItem();
    if (!firstColumn.isValid || !firstRow.isValid) {
      return false;
    }
    const firstColumnIndex = firstColumn.index;
    const columnCount = textSelection.columns.length;
    const firstRowIndex = firstRow.index;
    const rowCount = textSelection.rows.length;
    let table = textSelection;
    if (textSelection.constructor.name === "Cell") {
      table = textSelection.parent;
    }
    if (table.constructor.name !== "Table") {
      return false;
    }
    const splitRegExp = new RegExp(`[${tableColumnSeparator}${newLineChars}]+`, "i");
    const valueArray = value.split(splitRegExp);
    let i = 0;
    for (let r = firstRowIndex; r < rowCount + firstRowIndex; r += 1) {
      for (let c = firstColumnIndex; c < columnCount + firstColumnIndex; c += 1) {
        let targetCell = table.cells.itemByName(c + ":" + r);
        if (!targetCell.isValid) {
          continue;
        }
        let curValue = valueArray[i] ?? "";
        targetCell.contents = curValue;
        i += 1;
      }
    }
    return true;
  }
  return false;
}
function getTextSelection() {
  const { app } = indesign;
  if (app.documents.length === 0 || app.layoutWindows.length === 0) {
    return null;
  }
  const selectionArray = app.properties.selection;
  if (!selectionArray || !(selectionArray instanceof Array) || selectionArray.length === 0) {
    return null;
  }
  const firstSelection = selectionArray[0];
  if (!firstSelection || !("contents" in firstSelection) || !("isValid" in firstSelection) || !firstSelection.isValid) {
    return null;
  }
  return firstSelection;
}
function getSelectedTextContents(tableColumnSeparator, tableRowSeparator) {
  const textSelection = getTextSelection();
  if (!textSelection || !textSelection.isValid) {
    return "";
  }
  const contents = textSelection.contents;
  if (contents.constructor.name === "String" || contents.constructor.name === "Enumerator") {
    return contents;
  }
  if (contents instanceof Array && "rows" in textSelection && "columns" in textSelection) {
    const rowCount = textSelection.rows.length;
    const columnCount = textSelection.columns.length;
    let sliceStartIndex = 0;
    let sliceEndIndex = columnCount;
    let outputString = "";
    for (let r = 0; r < rowCount; r += 1) {
      const subArray = contents.slice(sliceStartIndex, sliceEndIndex);
      outputString += subArray.join(tableColumnSeparator);
      outputString += tableRowSeparator;
      sliceStartIndex = sliceEndIndex;
      sliceEndIndex += columnCount;
    }
    return outputString;
  }
  return "";
}
async function getSelectedItemAsBase64() {
  const altTextItem = getAltTextItem();
  if (!altTextItem) {
    return "";
  }
  const tempFolderObj = new import_helpers.FolderObject("plugin-temp:/");
  const isTempFolderExisting = await tempFolderObj.isExisting;
  if (!isTempFolderExisting) {
    return "";
  }
  const tempFolderEntry = await tempFolderObj.getFolderEntry();
  if (!tempFolderEntry) {
    return "";
  }
  const tempFolderPath = tempFolderEntry?.nativePath ?? "";
  if (!tempFolderPath) {
    return "";
  }
  const imageFileName = crypto.randomUUID() + ".jpeg";
  const imageFilePath = tempFolderPath + imageFileName;
  const imageFileObj = await exportItemAsImage(altTextItem, imageFilePath);
  if (!imageFileObj) {
    return "";
  }
  const imageArrayBuffer = await imageFileObj.getArrayBuffer();
  if (!imageArrayBuffer) {
    return "";
  }
  let imageBase64String = "data:image/jpeg;base64,";
  try {
    imageBase64String += (0, import_helpers.arrayBufferToBase64)(imageArrayBuffer);
  } catch (err) {
    console.error(err);
    return "";
  }
  return imageBase64String;
}
async function exportItemAsImage(sourcetItem, imageFilePath) {
  if (!sourcetItem || !Reflect.has(sourcetItem, "exportFile") || !sourcetItem.isValid) {
    return null;
  }
  const { app, ExportFormat, JPEGOptionsQuality, JPEGOptionsFormat, JpegColorSpaceEnum } = indesign;
  const presetObj = {
    "jpegQuality": JPEGOptionsQuality.HIGH,
    "jpegRenderingStyle": JPEGOptionsFormat.BASELINE_ENCODING,
    "exportResolution": 72,
    "jpegColorSpace": JpegColorSpaceEnum.RGB,
    "embedColorProfile": false,
    "antiAlias": false,
    "simulateOverprint": false
  };
  const userExportPrefs = app.jpegExportPreferences.properties;
  try {
    app.jpegExportPreferences.properties = presetObj;
    sourcetItem.exportFile(ExportFormat.JPG, imageFilePath, false);
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    app.jpegExportPreferences.properties = userExportPrefs;
  }
  const imageFileObj = new import_helpers.FileObject(imageFilePath);
  const isImageFileExisting = await imageFileObj.isExisting;
  if (!isImageFileExisting) {
    return null;
  }
  return imageFileObj;
}
async function cleanup() {
  indesign?.app?.removeEventListener("afterSelectionChanged", afterSelectionChangedHandler);
  import_bridge.stop();
}
/* ------------------------------------------------------------------ agent link */
function initAgentLink(state) {
  const switchElem = document.getElementById("agent-link-switch");
  if (switchElem) {
    switchElem.checked = import_config.isAgentLinkEnabled();
  }
  import_bridge.setStatusHandler(setAgentLinkStatus);
  if (import_config.isAgentLinkEnabled() && import_config.isBridgeConfigured()) {
    import_bridge.start();
  } else {
    setAgentLinkStatus(
      import_config.isBridgeConfigured() ? "Link off" : "No bridge URL",
      import_config.isBridgeConfigured() ? "" : "error"
    );
  }
  return true;
}
function setAgentLinkStatus(text, level) {
  const statusElem = document.getElementById("agent-link-status");
  if (!statusElem) {
    return false;
  }
  statusElem.textContent = text || "";
  statusElem.classList.remove("ok", "error");
  if (level) {
    statusElem.classList.add(level);
  }
  return true;
}
async function bridgeUrlButtonClickHandler(evt, state) {
  const dialog = new import_dialogs.CustomPrompt();
  const enteredUrl = await dialog.show({
    headline: "Arena bridge",
    message: "URL of the Arena bridge (empty = use OpenAI directly):",
    "defaultValue": import_config.getBridgeUrl()
  }).catch(() => "");
  if (enteredUrl === undefined || enteredUrl === null) {
    return false;
  }
  const cleanUrl = String(enteredUrl).trim().replace(/\/+$/, "");
  import_config.setStoredBridgeUrl(cleanUrl);
  if (cleanUrl && import_config.isAgentLinkEnabled()) {
    import_bridge.stop();
    import_bridge.start();
  } else if (!cleanUrl) {
    import_bridge.stop();
  }
  const statusElem = document.getElementById("agent-link-status");
  if (statusElem) {
    statusElem.textContent = cleanUrl ? "Bridge: " + cleanUrl.replace(/^https?:\/\//, "") : "No bridge URL";
    statusElem.classList.remove("ok", "error");
  }
  return true;
}
async function agentLinkSwitchChangeHandler(evt, state) {
  const switchElem = document.getElementById("agent-link-switch");
  const isEnabled = !!switchElem?.checked;
  import_config.setAgentLinkEnabled(isEnabled);
  if (isEnabled) {
    import_bridge.start();
  } else {
    import_bridge.stop();
  }
  return true;
}
