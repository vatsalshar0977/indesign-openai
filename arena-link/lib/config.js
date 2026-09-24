"use strict";

/**
 * Bridge address.
 * The placeholder is replaced at build time by scripts/build-arena.mjs when the env
 * variable BRIDGE_URL is set. Anything typed into the panel wins over it.
 */

var BUILD_BRIDGE_URL = "__BRIDGE_URL__";

const STORAGE_KEY_URL = "arena-bridge-url";
const STORAGE_KEY_ENABLED = "arena-agent-enabled";

function getBuildBridgeUrl() {
  if (typeof BUILD_BRIDGE_URL !== "string") return "";
  if (BUILD_BRIDGE_URL === "" || BUILD_BRIDGE_URL.indexOf("__BRIDGE_URL__") === 0) return "";
  return BUILD_BRIDGE_URL;
}

function getStoredBridgeUrl() {
  try {
    return localStorage.getItem(STORAGE_KEY_URL) || "";
  } catch (err) {
    return "";
  }
}

function setStoredBridgeUrl(url) {
  try {
    const clean = String(url || "").trim().replace(/\/+$/, "");
    if (clean) localStorage.setItem(STORAGE_KEY_URL, clean);
    else localStorage.removeItem(STORAGE_KEY_URL);
  } catch (err) {
    console.warn("Could not store the bridge URL.", err);
  }
  return getBridgeUrl();
}

function getBridgeUrl() {
  return getStoredBridgeUrl() || getBuildBridgeUrl();
}

function isAgentEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY_ENABLED) !== "0";
  } catch (err) {
    return true;
  }
}

function setAgentEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "1" : "0");
  } catch (err) {
    console.warn("Could not store the agent switch state.", err);
  }
  return enabled;
}

module.exports = {
  getBridgeUrl,
  setStoredBridgeUrl,
  isAgentEnabled,
  setAgentEnabled
};
