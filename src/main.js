"use strict";

// src/js/main.ts
var import_create = require("./panel/create.js");
var uxp = require("uxp");
uxp.entrypoints.setup({
  "plugin": {
    create() {
    },
    destroy() {
    }
  },
  "panels": {
    "templatePanelId": {
      create(rootNode) {
        return new Promise((resolve, reject) => {
          (0, import_create.setup)(rootNode).then((wasSetUp) => {
            if (!wasSetUp) {
              throw new Error("Error on setup");
            }
            resolve("Setup successful");
          }).catch((err) => {
            console.error(err);
            reject(err.message);
          });
        });
      },
      show(rootNode) {
        return new Promise((resolve, reject) => {
          resolve("Panel shown");
        });
      },
      hide(rootNode) {
        return new Promise((resolve, reject) => {
          resolve("Panel hidden");
        });
      },
      destroy(rootNode) {
        return new Promise((resolve, reject) => {
          (0, import_create.cleanup)().then(() => {
            resolve("Panel destroyed");
          });
        });
      }
    }
  }
});
