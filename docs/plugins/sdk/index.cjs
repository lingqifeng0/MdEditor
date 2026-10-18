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

// src/shared/plugin-api.ts
var plugin_api_exports = {};
__export(plugin_api_exports, {
  PLUGIN_API_VERSION: () => PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS: () => PLUGIN_PERMISSIONS,
  PluginError: () => PluginError
});
module.exports = __toCommonJS(plugin_api_exports);
var PLUGIN_API_VERSION = 2;
var PLUGIN_PERMISSIONS = ["editor.read", "editor.write", "files.read", "files.write", "ui", "links", "desktop", "network"];
var PluginError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PluginError";
  }
  code;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS,
  PluginError
});
