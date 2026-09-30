"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPanelBaseName = exports.getPartBaseName = exports.normalizePartOrPanelName = void 0;
const normalizePartOrPanelName = (s) => s.replace(/\s+/g, " ").trim();
exports.normalizePartOrPanelName = normalizePartOrPanelName;
const getPartBaseName = (n, d, f) => `Part - ${n.replace(/^Panels-\s*/, "")} ${d ?? ""} ${f}`.replace(/\s+/g, " ").trim();
exports.getPartBaseName = getPartBaseName;
const getPanelBaseName = (n, d, f) => `Panel - ${n.replace(/^Panels-\s*/, "")} ${f}`.replace(/\s+/g, " ").trim();
exports.getPanelBaseName = getPanelBaseName;
