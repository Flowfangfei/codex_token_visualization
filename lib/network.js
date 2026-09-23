const tls = require("node:tls");

function useSystemCertificates(api = tls) {
  if (typeof api.getCACertificates !== "function" || typeof api.setDefaultCACertificates !== "function") return false;
  // Retain bundled and explicitly configured CAs; never disable TLS verification.
  api.setDefaultCACertificates([...new Set([
    ...api.getCACertificates("default"), ...api.getCACertificates("system"),
  ])]);
  return true;
}

const NETWORK_ERRORS = {
  SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate chain is not trusted; check the Windows/system certificate store",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is not trusted; check the Windows/system certificate store",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS issuer is not trusted; check the Windows/system certificate store",
  CERT_HAS_EXPIRED: "TLS certificate has expired; check the certificate and system clock",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the requested host",
  ENOTFOUND: "DNS lookup failed",
  EAI_AGAIN: "DNS lookup temporarily unavailable",
  ECONNREFUSED: "Connection refused; check the network or configured proxy",
  ECONNRESET: "Connection reset by the remote host or network",
  ETIMEDOUT: "Network connection timed out",
  UND_ERR_CONNECT_TIMEOUT: "Network connection timed out",
};

function networkErrorMessage(error) {
  const message = String(error?.message || error || "Unknown error");
  const queue = [error];
  const seen = new Set();
  for (let index = 0; index < queue.length && index < 16; index += 1) {
    const entry = queue[index];
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    if (Object.hasOwn(NETWORK_ERRORS, entry.code)) {
      return `${message} [${entry.code}]: ${NETWORK_ERRORS[entry.code]}`;
    }
    if (entry.cause) queue.push(entry.cause);
    if (Array.isArray(entry.errors)) queue.push(...entry.errors.slice(0, 8));
  }
  return message;
}

module.exports = { useSystemCertificates, networkErrorMessage };
