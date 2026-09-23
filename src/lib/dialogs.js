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
var dialogs_exports = {};
__export(dialogs_exports, {
  CustomAlert: () => CustomAlert,
  CustomConfirm: () => CustomConfirm,
  CustomDialog: () => CustomDialog,
  CustomPrompt: () => CustomPrompt,
  CustomTextarea: () => CustomTextarea
});
module.exports = __toCommonJS(dialogs_exports);
class CustomDialog {
  #defaultConfig = {};
  #id;
  #styleElement;
  #dialogElement;
  constructor(id = "") {
    this.#id = this.createId(id);
  }
  get defaultConfig() {
    return this.#defaultConfig;
  }
  set defaultConfig(value) {
    this.#defaultConfig = value;
  }
  get id() {
    return this.#id;
  }
  set id(value) {
    throw Error("Property [id] is read-only.");
  }
  get styles() {
    return ``;
  }
  set styles(value) {
    throw Error("Property [styles] is read-only.");
  }
  get template() {
    return ``;
  }
  set template(value) {
    throw Error("Property [template] is read-only.");
  }
  get eventHandlerSetups() {
    return [];
  }
  set eventHandlerSetups(value) {
    throw Error("Property [eventHandlerSetups] is read-only.");
  }
  get styleElement() {
    return this.#styleElement;
  }
  set styleElement(value) {
    throw Error("Property [styleElement] is read-only.");
  }
  get dialogElement() {
    return this.#dialogElement;
  }
  set dialogElement(value) {
    throw Error("Property [dialogElement] is read-only.");
  }
  mount() {
    let styleElem;
    if (this.styles !== "") {
      styleElem = document.createElement("style");
      const stylesTextNode = document.createTextNode(this.styles);
      styleElem.appendChild(stylesTextNode);
      document.head.appendChild(styleElem);
    }
    const dialogElem = document.createElement("dialog");
    dialogElem.setAttribute("id", this.#id);
    dialogElem.insertAdjacentHTML("beforeend", this.template);
    document.body.appendChild(dialogElem);
    this.eventHandlerSetups.forEach((item) => {
      const handlerElem = document.getElementById(item.id ?? "") || dialogElem.querySelector(item.query ?? "");
      handlerElem?.addEventListener(item.event, (evt) => {
        item.handler.call(this, evt);
      });
    });
    this.#dialogElement = dialogElem;
    this.#styleElement = styleElem;
    return this;
  }
  init() {
    return this;
  }
  createId(value) {
    if (!value) {
      return "x-" + crypto.randomUUID();
    }
    let id = value.replace(/(^\s+|\s+$)/g, "").replace(/\s+/g, "-").replace(/[<>]/g, "");
    if (/^\d/.test(id)) {
      id = "x-" + id;
    }
    if (/^-+/.test(id)) {
      id = "x" + id;
    }
    const idElem = document.getElementById(id);
    if (!!idElem) {
      id += "-" + crypto.randomUUID();
    }
    return id;
  }
  async show({ config = {}, once = true }) {
    if (!this.dialogElement) {
      this.mount().init();
    }
    const dialogElem = this.dialogElement;
    if (!dialogElem) {
      return "";
    }
    let configObj = {
      ...this.#defaultConfig,
      ...config
    };
    const result = await dialogElem.uxpShowModal(configObj);
    if (once === true) {
      this.delete();
    }
    return result;
  }
  close(evt) {
    if (!!this.dialogElement) {
      this.dialogElement.close("Dialog closed.");
    }
  }
  async delete() {
    if (!!this.styleElement) {
      this.styleElement.remove();
      this.#styleElement = void 0;
    }
    if (!!this.dialogElement) {
      this.dialogElement.remove();
      this.#dialogElement = void 0;
    }
  }
}
class CustomAlert extends CustomDialog {
  #defaultConfig = {
    "title": "",
    "resize": "both",
    /* "none", "both", "horizontal", "vertical" */
    "size": {
      "width": 400
    }
  };
  #id;
  constructor(id = "") {
    super(id);
    this.#id = this.id;
  }
  get styles() {
    return `
			dialog#${this.#id} {
				min-height: 100vh;
				padding: 0;
			}
			#${this.#id} form {
				height: 100vh;
				padding: 1rem 1.5rem 1.3rem 1.5rem;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
			}
			#${this.#id} header {
				display: flex;
				flex-direction: row;
				align-items: top;
				justify-content: start;
				margin-bottom: 0.5rem;
			}
			#${this.#id} header #icon-${this.#id} {
				display: none;
				margin-top: 0;
				margin-right: 0.5rem;
			}
			#${this.#id} header #headline-${this.#id} {
				margin-top: 0;
			}
			#${this.#id} #message-${this.#id} {
				margin-top: 0;
				max-height: 400px;
				overflow-y: auto;
			}
			html span[lang] {
				display: none;
			}
			html:not([lang]) span:lang(en),
			html:lang(ar) span:lang(ar),
			html:lang(cs) span:lang(cs),
			html:lang(da) span:lang(da),
			html:lang(de) span:lang(de),
			html:lang(en) span:lang(en),
			html:lang(es) span:lang(es),
			html:lang(fi) span:lang(fi),
			html:lang(fr) span:lang(fr),
			html:lang(he) span:lang(he),
			html:lang(hu) span:lang(hu),
			html:lang(it) span:lang(it),
			html:lang(ja) span:lang(ja),
			html:lang(ko) span:lang(ko),
			html:lang(nl) span:lang(nl),
			html:lang(no) span:lang(no),
			html:lang(pl) span:lang(pl),
			html:lang(pt) span:lang(pt),
			html:lang(ru) span:lang(ru),
			html:lang(sv) span:lang(sv),
			html:lang(tr) span:lang(tr),
			html:lang(uk) span:lang(uk),
			html:lang(zh) span:lang(zh) {
				display: initial;
			}
		`;
  }
  set styles(value) {
    throw Error("Property [styles] is read-only.");
  }
  get template() {
    return `
			<form method="dialog">
				<header>
					<sp-icon id="icon-${this.#id}" name="ui:AlertMedium" size="lg"></sp-icon>
					<sp-heading id="headline-${this.#id}" size="S"></sp-heading>
				</header>	
				<sp-body id="message-${this.#id}"></sp-body>
				<footer>
					<sp-button id="close-button-${this.#id}" treatment="fill" variant="primary">
						<span lang="en">Close</span>
						<span lang="de">Schließen</span>
					</sp-button>
				</footer>
			</form>
		`;
  }
  set template(value) {
    throw Error("Property [template] is read-only.");
  }
  get eventHandlerSetups() {
    return [
      { id: `close-button-${this.#id}`, event: "click", handler: this.close }
    ];
  }
  set eventHandlerSetups(value) {
    throw Error("Property [eventHandlerSetups] is read-only.");
  }
  init() {
    return this;
  }
  async show({ headline = "", message = "", config = {}, once = true, icon = false }) {
    if (!this.dialogElement) {
      this.mount().init();
    }
    const dialogElem = this.dialogElement;
    if (!dialogElem) {
      return "";
    }
    let configObj = {
      ...this.#defaultConfig,
      ...config
    };
    const iconElem = document.getElementById(`icon-${this.#id}`);
    if (!!iconElem) {
      if (icon === true) {
        iconElem.style.display = "initial";
      } else {
        iconElem.style.display = "none";
      }
    }
    const headlineElem = document.getElementById(`headline-${this.#id}`);
    if (!!headlineElem) {
      headlineElem.textContent = headline;
    }
    const messageElem = document.getElementById(`message-${this.#id}`);
    if (!!messageElem) {
      messageElem.innerHTML = message;
    }
    const result = await dialogElem.uxpShowModal(configObj);
    if (once === true) {
      this.delete();
    }
    return result;
  }
}
class CustomTextarea extends CustomDialog {
  #defaultConfig = {
    "title": "",
    "resize": "both",
    /* "none", "both", "horizontal", "vertical" */
    "size": {
      "width": 600
    }
  };
  #id;
  constructor(id = "") {
    super(id);
    this.#id = this.id;
  }
  get styles() {
    return `
			dialog#${this.#id} {
				min-height: 100vh;
				padding: 0;
			}
			#${this.#id} form {
				height: 100vh;
				padding: 1rem 1.5rem 1.3rem 1.5rem;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
			}
			#${this.#id} #label-${this.#id} {
				margin-top: 0;
				max-height: 400px;
				overflow-y: auto;
			}
			#${this.#id} #text-${this.#id} {
				width: 100%;
				height: 400px;
			}
			html span[lang] {
				display: none;
			}
			html:not([lang]) span:lang(en),
			html:lang(ar) span:lang(ar),
			html:lang(cs) span:lang(cs),
			html:lang(da) span:lang(da),
			html:lang(de) span:lang(de),
			html:lang(en) span:lang(en),
			html:lang(es) span:lang(es),
			html:lang(fi) span:lang(fi),
			html:lang(fr) span:lang(fr),
			html:lang(he) span:lang(he),
			html:lang(hu) span:lang(hu),
			html:lang(it) span:lang(it),
			html:lang(ja) span:lang(ja),
			html:lang(ko) span:lang(ko),
			html:lang(nl) span:lang(nl),
			html:lang(no) span:lang(no),
			html:lang(pl) span:lang(pl),
			html:lang(pt) span:lang(pt),
			html:lang(ru) span:lang(ru),
			html:lang(sv) span:lang(sv),
			html:lang(tr) span:lang(tr),
			html:lang(uk) span:lang(uk),
			html:lang(zh) span:lang(zh) {
				display: initial;
			}
		`;
  }
  set styles(value) {
    throw Error("Property [styles] is read-only.");
  }
  get template() {
    return `
			<form method="dialog">	
				<sp-label id="label-${this.#id}"></sp-label>
				<sp-textarea multiline id="text-${this.#id}"></sp-textarea>
				<footer>
					<sp-button id="close-button-${this.#id}" treatment="fill" variant="primary">
						<span lang="en">Close</span>
						<span lang="de">Schließen</span>
					</sp-button>
				</footer>
			</form>
		`;
  }
  set template(value) {
    throw Error("Property [template] is read-only.");
  }
  get eventHandlerSetups() {
    return [
      { id: `close-button-${this.#id}`, event: "click", handler: this.close.bind(this) }
    ];
  }
  set eventHandlerSetups(value) {
    throw Error("Property [eventHandlerSetups] is read-only.");
  }
  init() {
    return this;
  }
  async show({ label = "", text = "", config = {}, once = true }) {
    if (!this.dialogElement) {
      this.mount().init();
    }
    const dialogElem = this.dialogElement;
    if (!dialogElem) {
      return "";
    }
    let configObj = {
      ...this.#defaultConfig,
      ...config
    };
    const labelElem = document.getElementById(`label-${this.#id}`);
    if (!!labelElem) {
      labelElem.textContent = label;
    }
    const textElem = document.getElementById(`text-${this.#id}`);
    if (!!textElem) {
      textElem.textContent = text;
    }
    const result = await dialogElem.uxpShowModal(configObj);
    if (once === true) {
      this.delete();
    }
    return result;
  }
}
class CustomPrompt extends CustomDialog {
  #defaultConfig = {
    "title": "",
    "resize": "both",
    /* "none", "both", "horizontal", "vertical" */
    "size": {
      "width": 400
    }
  };
  #id;
  constructor(id = "") {
    super(id);
    this.#id = this.id;
  }
  get styles() {
    return `
			dialog#${this.#id} {
				min-height: 100vh;
				padding: 0;
			}
			#${this.#id} form {
				height: 100vh;
				padding: 1rem 1.5rem 1.3rem 1.5rem;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
			}
			#${this.#id} header {
				display: flex;
				flex-direction: row;
				align-items: top;
				justify-content: start;
				margin-bottom: 0.3rem;
			}
			#${this.#id} header #headline-${this.#id} {
				margin-top: 0;
			}
			#${this.#id} #message-${this.#id} {
				margin-top: 0;
				margin-bottom: 0.5rem;
				max-height: 400px;
				overflow-y: auto;
			}
			#${this.#id} #input-${this.#id} {
				width: 100%;
			}
			#${this.#id} footer sp-button {
				margin-left: 0.5rem;
			}
			html span[lang] {
				display: none;
			}
			html:not([lang]) span:lang(en),
			html:lang(ar) span:lang(ar),
			html:lang(cs) span:lang(cs),
			html:lang(da) span:lang(da),
			html:lang(de) span:lang(de),
			html:lang(en) span:lang(en),
			html:lang(es) span:lang(es),
			html:lang(fi) span:lang(fi),
			html:lang(fr) span:lang(fr),
			html:lang(he) span:lang(he),
			html:lang(hu) span:lang(hu),
			html:lang(it) span:lang(it),
			html:lang(ja) span:lang(ja),
			html:lang(ko) span:lang(ko),
			html:lang(nl) span:lang(nl),
			html:lang(no) span:lang(no),
			html:lang(pl) span:lang(pl),
			html:lang(pt) span:lang(pt),
			html:lang(ru) span:lang(ru),
			html:lang(sv) span:lang(sv),
			html:lang(tr) span:lang(tr),
			html:lang(uk) span:lang(uk),
			html:lang(zh) span:lang(zh) {
				display: initial;
			}
		`;
  }
  set styles(value) {
    throw Error("Property [styles] is read-only.");
  }
  get template() {
    return `
			<form method="dialog">
				<header>
					<sp-heading id="headline-${this.#id}" size="S"></sp-heading>
				</header>	
				<sp-body id="message-${this.#id}"></sp-body>
				<sp-textfield id="input-${this.#id}"></sp-textfield>
				<footer>
					<sp-button id="cancel-button-${this.#id}" treatment="fill" variant="secondary">
						<span lang="en">Cancel</span>
						<span lang="de">Abbrechen</span>
					</sp-button>
					<sp-button id="continue-button-${this.#id}" treatment="fill" variant="primary">
						<span lang="en">Continue</span>
						<span lang="de">Weiter</span>
					</sp-button>
				</footer>
			</form>
		`;
  }
  set template(value) {
    throw Error("Property [template] is read-only.");
  }
  get eventHandlerSetups() {
    return [
      { id: `continue-button-${this.#id}`, event: "click", handler: this.continue },
      { id: `cancel-button-${this.#id}`, event: "click", handler: this.cancel }
    ];
  }
  set eventHandlerSetups(value) {
    throw Error("Property [eventHandlerSetups] is read-only.");
  }
  init() {
    return this;
  }
  async show({ headline = "", message = "", defaultValue = "", config = {}, once = true }) {
    if (!this.dialogElement) {
      this.mount().init();
    }
    const dialogElem = this.dialogElement;
    if (!dialogElem) {
      return "";
    }
    let configObj = {
      ...this.#defaultConfig,
      ...config
    };
    const headlineElem = document.getElementById(`headline-${this.#id}`);
    if (!!headlineElem) {
      headlineElem.textContent = headline;
    }
    const messageElem = document.getElementById(`message-${this.#id}`);
    if (!!messageElem) {
      messageElem.innerHTML = message;
    }
    const textfieldElem = document.getElementById(`input-${this.#id}`);
    if (!!textfieldElem) {
      textfieldElem.value = defaultValue;
    }
    const result = await dialogElem.uxpShowModal(configObj);
    if (once === true) {
      this.delete();
    }
    return result;
  }
  continue(evt) {
    if (!this.dialogElement) {
      return;
    }
    let input = "";
    const textfieldElem = this.dialogElement.querySelector("sp-textfield");
    if (!!textfieldElem) {
      input = textfieldElem.value;
    }
    this.dialogElement.close(input);
  }
  cancel(evt) {
    if (!this.dialogElement) {
      return;
    }
    this.dialogElement.close("");
  }
}
class CustomConfirm extends CustomDialog {
  #defaultConfig = {
    "title": "",
    "resize": "both",
    /* "none", "both", "horizontal", "vertical" */
    "size": {
      "width": 400
    }
  };
  #id;
  constructor(id = "") {
    super(id);
    this.#id = this.id;
  }
  get styles() {
    return `
			dialog#${this.#id} {
				min-height: 100vh;
				padding: 0;
			}
			#${this.#id} form {
				height: 100vh;
				padding: 1rem 1.5rem 1.3rem 1.5rem;
				display: flex;
				flex-direction: column;
				justify-content: space-between;
			}
			#${this.#id} header {
				display: flex;
				flex-direction: row;
				align-items: top;
				justify-content: start;
				margin-bottom: 0.3rem;
			}
			#${this.#id} header #headline-${this.#id} {
				margin-top: 0;
			}
			#${this.#id} #message-${this.#id} {
				margin-top: 0;
				margin-bottom: 0.5rem;
				max-height: 400px;
				overflow-y: auto;
			}
			#${this.#id} #text-${this.#id} {
				width: 100%;
			}
			#${this.#id} footer sp-button {
				margin-left: 0.5rem;
			}
			html span[lang] {
				display: none;
			}
			html:not([lang]) span:lang(en),
			html:lang(ar) span:lang(ar),
			html:lang(cs) span:lang(cs),
			html:lang(da) span:lang(da),
			html:lang(de) span:lang(de),
			html:lang(en) span:lang(en),
			html:lang(es) span:lang(es),
			html:lang(fi) span:lang(fi),
			html:lang(fr) span:lang(fr),
			html:lang(he) span:lang(he),
			html:lang(hu) span:lang(hu),
			html:lang(it) span:lang(it),
			html:lang(ja) span:lang(ja),
			html:lang(ko) span:lang(ko),
			html:lang(nl) span:lang(nl),
			html:lang(no) span:lang(no),
			html:lang(pl) span:lang(pl),
			html:lang(pt) span:lang(pt),
			html:lang(ru) span:lang(ru),
			html:lang(sv) span:lang(sv),
			html:lang(tr) span:lang(tr),
			html:lang(uk) span:lang(uk),
			html:lang(zh) span:lang(zh) {
				display: initial;
			}
		`;
  }
  set styles(value) {
    throw Error("Property [styles] is read-only.");
  }
  get template() {
    return `
			<form method="dialog">
				<header>
					<sp-heading id="headline-${this.#id}" size="S"></sp-heading>
				</header>	
				<sp-body id="message-${this.#id}"></sp-body>
				<footer>
					<sp-button id="no-button-${this.#id}" treatment="fill" variant="secondary">
						<span lang="en">No</span>
						<span lang="de">Nein</span>
					</sp-button>
					<sp-button id="yes-button-${this.#id}" treatment="fill" variant="primary">
						<span lang="en">Yes</span>
						<span lang="de">Ja</span>
					</sp-button>
				</footer>
			</form>
		`;
  }
  set template(value) {
    throw Error("Property [template] is read-only.");
  }
  get eventHandlerSetups() {
    return [
      { id: `yes-button-${this.#id}`, event: "click", handler: this.continue },
      { id: `no-button-${this.#id}`, event: "click", handler: this.cancel }
    ];
  }
  set eventHandlerSetups(value) {
    throw Error("Property [eventHandlerSetups] is read-only.");
  }
  init() {
    return this;
  }
  async show({ headline = "", message = "", config = {}, once = true }) {
    if (!this.dialogElement) {
      this.mount().init();
    }
    const dialogElem = this.dialogElement;
    if (!dialogElem) {
      return "no";
    }
    let configObj = {
      ...this.#defaultConfig,
      ...config
    };
    const headlineElem = document.getElementById(`headline-${this.#id}`);
    if (!!headlineElem) {
      headlineElem.textContent = headline;
    }
    const messageElem = document.getElementById(`message-${this.#id}`);
    if (!!messageElem) {
      messageElem.innerHTML = message;
    }
    const result = await dialogElem.uxpShowModal(configObj);
    if (once === true) {
      this.delete();
    }
    if (result !== "yes") {
      return "no";
    }
    return result;
  }
  continue(evt) {
    if (!this.dialogElement) {
      return;
    }
    this.dialogElement.close("yes");
  }
  cancel(evt) {
    if (!this.dialogElement) {
      return;
    }
    this.dialogElement.close("no");
  }
}
