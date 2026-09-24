"use strict";

/* src/js/main.ts */
var import_panel = require("./panel/panel.js");
var uxp = require("uxp");

uxp.entrypoints.setup({
  "plugin": {
    create() {},
    destroy() {}
  },
  "panels": {
    "arenaPanelId": {
      create(rootNode) {
        return new Promise((resolve, reject) => {
          import_panel.setup(rootNode).then((wasSetUp) => {
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
        return Promise.resolve("Panel shown");
      },
      hide(rootNode) {
        return Promise.resolve("Panel hidden");
      },
      destroy(rootNode) {
        return new Promise((resolve) => {
          import_panel.cleanup().then(() => resolve("Panel destroyed"));
        });
      }
    }
  }
});
