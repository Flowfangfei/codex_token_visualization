import registry from "../providers/registry.js";

function output(value) {
  const json = JSON.stringify(value);
  if (process.argv.includes("--base64")) {
    process.stdout.write(Buffer.from(json, "utf8").toString("base64"));
  } else {
    process.stdout.write(`${json}\n`);
  }
}

if (process.argv.includes("--ccusage-sources")) {
  output(registry.AUTO_EXPORT_SOURCES.map((entry) => entry.id));
} else {
  const sourceIndex = process.argv.indexOf("--source");
  const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : null;
  const provider = registry.getProvider(source);
  if (!provider || provider.usage.adapter !== "ccusage") {
    process.stderr.write(`No ccusage provider is registered for ${source || "(missing)"}\n`);
    process.exitCode = 1;
  } else {
    output({
      id: provider.id,
      filePrefix: provider.usage.filePrefix,
      ccusageArgs: provider.usage.ccusageArgs,
      logRoot: provider.usage.logRoot,
      legacyRoots: provider.usage.legacyRoots || [],
    });
  }
}
