const test = require("node:test");
const assert = require("node:assert/strict");
const { useSystemCertificates, networkErrorMessage } = require("../lib/network.js");

test("system trust adds OS roots without discarding default or custom roots", () => {
  let installed;
  assert.equal(useSystemCertificates({
    getCACertificates: (type) => type === "default" ? ["bundled", "custom"] : ["custom", "system"],
    setDefaultCACertificates: (certificates) => { installed = certificates; },
  }), true);
  assert.deepEqual(installed, ["bundled", "custom", "system"]);
});

test("older runtimes leave certificate configuration intact for the startup flag", () => {
  assert.equal(useSystemCertificates({}), false);
  assert.equal(useSystemCertificates({ getCACertificates: () => assert.fail("Should not read roots") }), false);
});

test("TLS errors expose a diagnostic code, not nested request credentials", () => {
  const error = new Error("fetch failed", { cause: Object.assign(new Error("private request detail"), {
    code: "SELF_SIGNED_CERT_IN_CHAIN",
  }) });
  const message = networkErrorMessage(error);
  assert.match(message, /SELF_SIGNED_CERT_IN_CHAIN/);
  assert.doesNotMatch(message, /private request detail/);
  assert.match(message, /certificate store/);
});

test("network diagnostics inspect aggregate errors and terminate on cyclic causes", () => {
  assert.match(networkErrorMessage(new Error("fetch failed", {
    cause: new AggregateError([Object.assign(new Error("hidden"), { code: "ETIMEDOUT" })]),
  })), /ETIMEDOUT/);
  const error = new Error("unchanged");
  error.cause = error;
  assert.equal(networkErrorMessage(error), "unchanged");
  assert.equal(networkErrorMessage(new Error("HTTP 401")), "HTTP 401");
});
