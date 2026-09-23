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
var locales_exports = {};
__export(locales_exports, {
  localeObj: () => localeObj
});
module.exports = __toCommonJS(locales_exports);
const localeObj = {
  "unknownErrorLabel": {
    "default": "Unknown Error",
    "de": "Unbekannter Fehler"
  },
  "labelError": {
    "default": "Label for translation not defined.",
    "de": "Label für Übersetzung nicht definiert."
  },
  "noDocOpenAlert": {
    "default": "A document must be open to execute the script!",
    "de": "Für die Ausführung des Skriptes ist ein geöffnetes Dokument erforderlich!"
  },
  "goBackLabel": {
    "default": "Go back label",
    "de": "Zurück Label"
  },
  "processingErrorAlert": {
    "default": "Error processing the document!",
    "de": "Fehler bei der Verarbeitung des Dokuments!"
  },
  "errorMessageLabel": {
    "default": "Error message:",
    "de": "Fehlermeldung:"
  },
  "logDialogTitle": {
    "default": "Messages",
    "de": "Meldungen"
  },
  "okButtonLabel": {
    "default": "OK",
    "de": "OK"
  },
  "closeButtonLabel": {
    "default": "Close",
    "de": "Schließen"
  },
  "modelGpt5Label": {
    "default": "Completion (gpt-5)",
    "de": "Textgenerierung (gpt-5)"
  },
  "modelGpt5MiniLabel": {
    "default": "Completion (gpt-5-mini)",
    "de": "Textgenerierung (gpt-5-mini)"
  },
  "modelGpto4MiniLabel": {
    "default": "Completion (o4-mini)",
    "de": "Textgenerierung (o4-mini)"
  },
  "modelGpt41Label": {
    "default": "Completion (gpt-4.1)",
    "de": "Textgenerierung (gpt-4.1)"
  },
  "modelGpt4oLabel": {
    "default": "Completion (gpt-4o)",
    "de": "Textgenerierung (gpt-4o)"
  },
  "modelGpt4TurboLabel": {
    "default": "Completion (gpt-4-turbo)",
    "de": "Textgenerierung (gpt-4-turbo)"
  },
  "modelGpt4Label": {
    "default": "Completion (gpt-4)",
    "de": "Textgenerierung (gpt-4)"
  },
  "modelGpt35Label": {
    "default": "Completion (gpt-3.5-turbo)",
    "de": "Textgenerierung (gpt-3.5-turbo)"
  },
  "modelGpt4VisionLabel": {
    "default": "Image Description (gpt-4o)",
    "de": "Bildbeschreibung (gpt-4o)"
  },
  "nSliderLabel": {
    "default": "Number of Choices",
    "de": "Anzahl der Antworten"
  },
  "temperatureSliderLabel": {
    "default": "Creativity",
    "de": "Kreativität"
  },
  "instructionTextareaLabel": {
    "default": "Instruction",
    "de": "Anweisung"
  },
  "instructionTextarea@placeholder": {
    "default": "Instruction",
    "de": "Anweisung"
  },
  "optionalInputTextareaLabel": {
    "default": "Optional Text",
    "de": "Optionaler Text"
  },
  "optionalInputTextarea@placeholder": {
    "default": "Optional Text",
    "de": "Optionaler Text"
  },
  "sendButtonLabel": {
    "default": "Send",
    "de": "Senden"
  },
  "abortButtonLabel": {
    "default": "Abort",
    "de": "Abbrechen"
  },
  "outputTextarea@placeholder": {
    "default": "Result",
    "de": "Antwort"
  },
  "spinnerLabel": {
    "default": "Loading …",
    "de": "Abrufen …"
  },
  "insertButtonLabel": {
    "default": "Insert",
    "de": "Einfügen"
  },
  "emptyInstructionTextareaErrorMessage": {
    "default": "The Instruction field must not be empty.",
    "de": "Das Anweisungsfeld darf nicht leer sein."
  },
  "noNetworkErrorMessage": {
    "default": "No network connection available.",
    "de": "Keine Netzwerkverbindung verfügbar."
  },
  "noRequestDataErrorMessage": {
    "default": "Data for request not available.",
    "de": "Daten für Anfrage nicht verfügbar."
  },
  "failedRequestErrorMessage": {
    "default": "Request failed.",
    "de": "Anfrage fehlgeschlagen."
  },
  "noChoicesPropertyErrorMessage": {
    "default": "No choices in request data object.",
    "de": "Keine Auswahl im Datenobjekt der Anfrage."
  },
  "fetchResponseErrorMessage": {
    "default": "Fetching data did not work.",
    "de": "Abruf der Daten fehlgeschlagen."
  },
  "apiKeyPromptHeadline": {
    "default": "OpenAI API Key",
    "de": "OpenAI API Key"
  },
  "apiKeyPromptMessage": {
    "default": "To connect to OpenAI, you need an API key. Informations on https://help.openai.com<br><br>Please enter API key here:",
    "de": "Um dich mit OpenAI zu verbinden, benötigst du einen API Key. Nähere Informationen dazu findest du unter https://help.openai.com<br><br>API Key bitte hier eingeben:"
  },
  "apiKeySetInfoMessage": {
    "default": "API key [$1] for [$2] could not be set.",
    "de": "API key [$1] für [$2] konnte nicht gesetzt werden."
  },
  "apiKeyGetInfoMessage": {
    "default": "API key for [$1] does not exist.",
    "de": "API key für [$1] nicht vorhanden."
  },
  "noApiKeyInfoMessage": {
    "default": "Please enter the OpenAI API Key. (Key icon in the upper right corner.)",
    "de": "Bitte API Key eintragen. (Schlüssel-Icon oben rechts.)"
  },
  "removeApiKeyErrorMessage": {
    "default": "API key [$1] could not be removed.",
    "de": "API key [$1] konnte nicht entfernt werden."
  },
  "placeTextUndoLabel": {
    "default": "Place text",
    "de": "Text platzieren"
  },
  "apiKeyButton@title": {
    "default": "Set API key",
    "de": "API Key einfügen"
  },
  "instructionClearButton@title": {
    "default": "Clear instruction",
    "de": "Anweisung löschen"
  },
  "optionalInputClearButton@title": {
    "default": "Clear optional input",
    "de": "Optionalen Text löschen"
  },
  "optionalInputImportButton@title": {
    "default": "Import from document",
    "de": "Aus Dokument importieren"
  },
  "transferResultButton@title": {
    "default": "Transfer to optional input field",
    "de": "In optionales Eingabefeld übertragen"
  },
  "clipboardButton@title": {
    "default": "Copy text to clipboard",
    "de": "In Zwischenablage kopieren"
  },
  "imageDescriptionDefaultInstruction": {
    "default": "Create a short text description to convey equivalent information for this image to assistive technology users. (Accessibility) The target language is English.",
    "de": "Erstelle eine kurze Textbeschreibung, um Nutzerinnen und Nutzern von assistierenden Technologien gleichwertige Informationen zu diesem Bild zu vermitteln. (Barrierefreiheit) Zielsprache ist Deutsch."
  },
  "instructionAdditionForExistingAltText": {
    "default": "Existing image description:",
    "de": "Vorhandene Bildbeschreibung:"
  },
  "noImageUrlErrorMessage": {
    "default": "Graphic for description could not be determined.",
    "de": "Grafik für Beschreibung konnte nicht ermittelt werden."
  }
  /* ... */
};
