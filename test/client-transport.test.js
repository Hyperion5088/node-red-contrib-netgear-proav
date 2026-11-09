"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { NetgearProAvClient, NetgearProAvResponseError } = require("../lib/client");

async function serve(t, server) {
  const sockets = new Set();
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve); }));
  return server.address().port;
}

test("omitted cap retains complete body; exact byte cap accepts multibyte UTF-8", async t => {
  const port = await serve(t, http.createServer((req, res) => res.end("€€")));
  const url = new URL(`http://127.0.0.1:${port}/synthetic`);
  assert.equal((await new NetgearProAvClient({ host: "unused" }).rawRequest(url, {})).body, "€€");
  assert.equal((await new NetgearProAvClient({ host: "unused", maxResponseBytes: 6 }).rawRequest(url, {})).body, "€€");
  await assert.rejects(new NetgearProAvClient({ host: "unused", maxResponseBytes: 5 }).rawRequest(url, {}), NetgearProAvResponseError);
});

test("oversized response rejects while stream remains open and destroys connection", { timeout: 3000 }, async t => {
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const port = await serve(t, http.createServer((req, res) => {
    res.on("close", closed);
    res.write("1234");
    const timer = setTimeout(() => res.write("5678"), 10);
    res.on("close", () => clearTimeout(timer));
    // Intentionally no end: only the client's streaming cap can finish this read.
  }));
  const client = new NetgearProAvClient({ host: "unused", maxResponseBytes: 5, timeout: 2000 });
  await assert.rejects(client.rawRequest(new URL(`http://127.0.0.1:${port}/synthetic`), {}), /response exceeded maxResponseBytes/);
  await disconnected;
});

test("invalid configured caps reject rather than silently disabling the bound", () => {
  for (const value of [0, -1, 1.5, true, "10", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new NetgearProAvClient({ host: "unused", maxResponseBytes: value }), /positive safe integer/);
  }
});

test("explicit CA permits local TLS while default verified trust rejects it", async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "netgear-client-tls-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const key = path.join(folder, "fixture.key"), cert = path.join(folder, "fixture.crt"), config = path.join(folder, "fixture.cnf");
  fs.writeFileSync(config, "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Local transport fixture\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n");
  execFileSync("openssl", ["req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-config", config], { stdio: "ignore" });
  const pem = fs.readFileSync(cert);
  const port = await serve(t, https.createServer({ key: fs.readFileSync(key), cert: pem }, (req, res) => res.end("{}")));
  const url = new URL(`https://127.0.0.1:${port}/synthetic`);
  await assert.rejects(new NetgearProAvClient({ host: "unused", verifySsl: true }).rawRequest(url, {}));
  const trusted = new NetgearProAvClient({ host: "unused", verifySsl: true, ca: pem, maxResponseBytes: 2 });
  assert.equal((await trusted.rawRequest(url, {})).body, "{}");
  await assert.rejects(trusted.rawRequest(url, { servername: "not-in-fixture.invalid" }),
    error => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
});

async function mismatchFixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "netgear-client-pin-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const key = path.join(folder, "fixture.key"), cert = path.join(folder, "fixture.crt"), config = path.join(folder, "fixture.cnf");
  fs.writeFileSync(config, "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Pin fixture\n[ext]\nsubjectAltName=DNS:fixture.invalid\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n");
  execFileSync("openssl", ["req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-config", config], { stdio: "ignore" });
  const pem = fs.readFileSync(cert);
  let requests = 0;
  const port = await serve(t, https.createServer({ key: fs.readFileSync(key), cert: pem }, (req, res) => { requests++; res.end("{}"); }));
  const fingerprint = new (require("node:crypto").X509Certificate)(pem).fingerprint256;
  return { pem, fingerprint, url: new URL(`https://127.0.0.1:${port}/synthetic`), requests: () => requests };
}

test("approved leaf pin plus CA accepts a name mismatch; pin never replaces chain trust", async t => {
  const f = await mismatchFixture(t);
  await assert.rejects(new NetgearProAvClient({ host: "unused", verifySsl: true, ca: f.pem }).rawRequest(f.url, {}), error => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
  const untrusted = new NetgearProAvClient({ host: "unused", verifySsl: true, certificateFingerprint256: f.fingerprint });
  untrusted.verifySsl = false; // A configured pin still forces verified chain trust.
  await assert.rejects(untrusted.rawRequest(f.url, {}));
  assert.equal(f.requests(), 0);
  const client = new NetgearProAvClient({ host: "unused", verifySsl: true, ca: f.pem, certificateFingerprint256: f.fingerprint });
  assert.equal((await client.rawRequest(f.url, {})).body, "{}");
  assert.equal(f.requests(), 1);
});

test("wrong leaf pin rejects before HTTP; pin cannot enable insecure TLS or HTTP", async t => {
  const f = await mismatchFixture(t);
  const client = new NetgearProAvClient({ host: "unused", verifySsl: true, ca: f.pem, certificateFingerprint256: "00".repeat(32) });
  await assert.rejects(client.rawRequest(f.url, {}), error => error.code === "ERR_TLS_CERT_FINGERPRINT_MISMATCH");
  assert.equal(f.requests(), 0);
  await assert.rejects(client.rawRequest(new URL("http://127.0.0.1:1/synthetic"), {}), /requires HTTPS/);
  assert.throws(() => new NetgearProAvClient({ host: "unused", verifySsl: false, certificateFingerprint256: f.fingerprint }), /requires verifySsl/);
});
