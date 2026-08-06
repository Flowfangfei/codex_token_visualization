const fs = require("node:fs");
const path = require("node:path");

function availableProviderIds(providers) {
  return (providers || [])
    .filter((provider) => provider?.navigation !== false && provider?.id)
    .map((provider) => provider.id);
}

function defaultDisplaySettings(providers) {
  return {
    version: 1,
    visibleProviders: availableProviderIds(providers),
    hiddenProviders: [],
  };
}

function normalizeDisplaySettings(value, providers) {
  const available = availableProviderIds(providers);
  const availableSet = new Set(available);
  const requestedHidden = Array.isArray(value?.hiddenProviders)
    ? value.hiddenProviders
    : Array.isArray(value?.visibleProviders)
      ? available.filter((id) => !value.visibleProviders.map(String).includes(id))
      : [];
  const hiddenSet = new Set([...new Set(requestedHidden.map(String))].filter((id) => availableSet.has(id)));
  let visibleProviders = available.filter((id) => !hiddenSet.has(id));
  if (!visibleProviders.length && available.length) {
    visibleProviders = available.slice(0, 1);
    hiddenSet.delete(visibleProviders[0]);
  }

  return {
    version: 1,
    visibleProviders,
    hiddenProviders: available.filter((id) => hiddenSet.has(id)),
  };
}

function readDisplaySettings(filePath, providers) {
  const defaults = defaultDisplaySettings(providers);
  if (!fs.existsSync(filePath)) return defaults;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    return normalizeDisplaySettings(parsed, providers);
  } catch (_) {
    return defaults;
  }
}

function writeDisplaySettings(filePath, payload, providers) {
  const settings = normalizeDisplaySettings(payload, providers);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
  return settings;
}

module.exports = {
  availableProviderIds,
  defaultDisplaySettings,
  normalizeDisplaySettings,
  readDisplaySettings,
  writeDisplaySettings,
};
