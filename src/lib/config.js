"use strict";

/**
 * Bridge configuration.
 *
 * The placeholder below is replaced at build time by `scripts/build.mjs`
 * when the env variable BRIDGE_URL is set (`BRIDGE_URL=https://host npm run build`).
 * Whatever is entered at runtime in the panel (link button) always wins,
 * so a plugin built without a URL can still be pointed at a bridge later.
 */

var BUILD_BRIDGE_URL = "https://8787-ilm424zkdt5d8vzjymrxr.e2b.app";

const STORAGE_KEY_URL = "arena-bridge-url";
const STORAGE_KEY_ENABLED = "arena-bridge-enabled";

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
    if (!url) {
      localStorage.removeItem(STORAGE_KEY_URL);
    } else {
      localStorage.setItem(STORAGE_KEY_URL, String(url).replace(/\/+$/, ""));
    }
  } catch (err) {
    console.warn("Could not persist the bridge URL.", err);
  }
  return getBridgeUrl();
}

/** URL of the Arena bridge, or "" when the plugin talks to OpenAI directly. */
function getBridgeUrl() {
  return getStoredBridgeUrl() || getBuildBridgeUrl();
}

function isBridgeConfigured() {
  return getBridgeUrl() !== "";
}

/** On unless it was explicitly switched off - the agent link is the point of this fork. */
function isAgentLinkEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY_ENABLED) !== "0";
  } catch (err) {
    return true;
  }
}

function setAgentLinkEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? "1" : "0");
  } catch (err) {
    console.warn("Could not persist the agent link state.", err);
  }
  return enabled;
}

module.exports = {
  getBridgeUrl,
  setStoredBridgeUrl,
  isBridgeConfigured,
  isAgentLinkEnabled,
  setAgentLinkEnabled
};
