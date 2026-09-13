function summarizeRefreshResults(results) {
  const succeeded = results.filter((item) => item.ok === true).length;
  const ok = results.length > 0 && results.every((item) => item.ok === true && !item.partial);
  return { ok, partial: succeeded > 0 && !ok, results };
}

module.exports = { summarizeRefreshResults };
