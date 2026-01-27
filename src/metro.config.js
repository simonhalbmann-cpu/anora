// metro.config.js (repo root)
const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/src/defaults/exclusionList");

const config = getDefaultConfig(__dirname);

// Wichtig: functions/ (Firebase Functions) darf NIEMALS von Metro gebundled werden
config.resolver.blockList = exclusionList([
  /\/functions\/.*/,
  /\\functions\\.*$/,
]);

module.exports = config;