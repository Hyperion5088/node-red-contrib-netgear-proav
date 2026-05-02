"use strict";

const http = require("node:http");
const https = require("node:https");

class NetgearProAvError extends Error {}
class NetgearProAvAuthError extends NetgearProAvError {}
class NetgearProAvResponseError extends NetgearProAvError {}

class NetgearProAvClient {
  constructor(options) {
    this.host = options.host;
    this.port = Number(options.port || 443);
    this.username = options.username;
    this.password = options.password;
    this.verifySsl = Boolean(options.verifySsl);
    this.timeout = Number(options.timeout || 15000);
    this.sessionToken = null;
    this.sessionTokenCreated = 0;
    this.sessionTokenTtl = Number(options.sessionTokenTtl || 23 * 60 * 60 * 1000);
  }

  get baseUrl() {
    if (this.port === 443) {
      return `https://${this.host}/api/v1`;
    }
    if (this.port === 80) {
      return `http://${this.host}/api/v1`;
    }
    return `https://${this.host}:${this.port}/api/v1`;
  }

  get legacyBaseUrl() {
    return `https://${this.host}:8443/api/v1`;
  }

  async login() {
    const data = await this.request("POST", "login", {
      authenticated: false,
      payload: { user: { name: this.username, password: this.password } }
    });
    const token = data && data.user && data.user.session;
    if (!token) {
      throw new NetgearProAvAuthError("login did not return a session token");
    }
    this.sessionToken = token;
    this.sessionTokenCreated = Date.now();
  }

  async logout() {
    if (!this.sessionToken) {
      return;
    }
    try {
      await this.request("POST", "logout");
    } finally {
      this.sessionToken = null;
      this.sessionTokenCreated = 0;
    }
  }

  sessionExpired() {
    return !this.sessionTokenCreated || Date.now() - this.sessionTokenCreated >= this.sessionTokenTtl;
  }

  async get(path, params) {
    return this.withSession(() => this.request("GET", path, { params }));
  }

  async post(path, payload, params, options = {}) {
    return this.withSession(() => this.request("POST", path, { payload, params, allowEmpty: options.allowEmpty }));
  }

  async legacyGet(path, params) {
    return this.request("GET", path, { params, legacy: true });
  }

  async legacyPost(path, payload, params) {
    return this.request("POST", path, { payload, params, legacy: true });
  }

  async withSession(fn) {
    if (!this.sessionToken || this.sessionExpired()) {
      await this.login();
    }
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof NetgearProAvAuthError)) {
        throw error;
      }
      this.sessionToken = null;
      this.sessionTokenCreated = 0;
      await this.login();
      return fn();
    }
  }

  async request(method, path, options = {}) {
    const base = options.legacy ? this.legacyBaseUrl : this.baseUrl;
    const url = new URL(`${base}/${String(path).replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(options.params || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = { Accept: "application/json" };
    let body;
    if (options.payload !== undefined) {
      body = JSON.stringify(options.payload);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    if (options.legacy) {
      headers.Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
    } else if (options.authenticated !== false) {
      if (!this.sessionToken) {
        throw new NetgearProAvAuthError("missing session token");
      }
      headers.session = this.sessionToken;
    }

    const response = await this.rawRequest(url, { method, headers, body });
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new NetgearProAvAuthError(`${path} authentication failed`);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new NetgearProAvError(`${path} returned HTTP ${response.statusCode}: ${response.body.slice(0, 300)}`);
    }
    if (!response.body.trim()) {
      if (options.allowEmpty) {
        return null;
      }
      throw new NetgearProAvResponseError(`${path} returned an empty response`);
    }

    let data;
    try {
      data = JSON.parse(response.body);
    } catch (error) {
      throw new NetgearProAvResponseError(`${path} did not return valid JSON`);
    }
    this.validateEnvelope(path, data);
    return data;
  }

  rawRequest(url, options) {
    const transport = url.protocol === "http:" ? http : https;
    const agent = url.protocol === "https:" ? new https.Agent({ rejectUnauthorized: this.verifySsl }) : undefined;

    return new Promise((resolve, reject) => {
      const req = transport.request(url, { ...options, agent, timeout: this.timeout }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      });
      req.on("timeout", () => {
        req.destroy(new NetgearProAvError(`timed out calling ${url.pathname.replace(/^\/api\/v1\//, "")}`));
      });
      req.on("error", reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  validateEnvelope(path, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new NetgearProAvResponseError(`${path} did not return a JSON object`);
    }
    const resp = data.resp && typeof data.resp === "object" ? data.resp : data;
    if (resp.status === "failure" || resp.status === "fail" || resp.status === "error") {
      if (resp.respCode === 12001 || resp.respCode === 12002 || resp.respCode === 403) {
        throw new NetgearProAvAuthError(resp.respMsg || "authentication failed");
      }
      throw new NetgearProAvError(resp.respMsg || `NETGEAR API request failed for ${path}`);
    }
  }

  deviceInfo() {
    return this.get("device_info");
  }

  portConfig(portId) {
    return portId ? this.get("swcfg_port", { portid: portId }) : this.get("swcfg_port");
  }

  portsStatus() {
    return this.get("swcfg_ports_status", { indexPage: 1, pageSize: 9999 });
  }

  portStatus() {
    return this.get("port_status", { pageSize: 9999 });
  }

  portStatistics(type) {
    return this.get("port_statistics", { type, indexPage: 1, pageSize: 9999 });
  }

  fiberOptics() {
    return this.get("fiber_optics");
  }

  fiberOpticsDiag() {
    return this.get("fiber_optics_diag");
  }

  fiberOpticsEeprom() {
    return this.get("fiber_optics_eeprom");
  }

  imageInfo() {
    return this.get("imageInfo");
  }

  neighbors() {
    return this.get("neighbor", { indexPage: 1, pageSize: 99999 });
  }

  profileList() {
    return this.get("profile/list");
  }

  poeInfo() {
    return this.get("swcfg_poe_info");
  }

  async poePortConfig(portId) {
    try {
      return await this.legacyGet("swcfg_poe", { portid: String(portId) });
    } catch (error) {
      if (error instanceof NetgearProAvAuthError) {
        throw error;
      }
      return this.get("swcfg_poe", { portid: String(portId) });
    }
  }

  lagConfig() {
    return this.get("sw_lag_cfg");
  }

  stacking() {
    return this.get("stacking");
  }

  vlanMembership(vlanId) {
    return this.get("vlan", { vlan_id: vlanId });
  }

  saveConfig() {
    return this.post("switch_config");
  }

  reboot(save = true) {
    return this.post("device_power", { power: { type: "reboot", save: Boolean(save) } }, undefined, { allowEmpty: true });
  }

  setFanMode(fanMode) {
    return this.post("device_fan", { fanMode: Number(fanMode) });
  }

  async setPortAdminState(portId, enabled, config) {
    const current = config || await this.firstRowFromPortConfig(portId);
    const row = {
      ...current,
      port: String(current.port || portId),
      portNum: Number(portId),
      portStr: current.portStr || current.portName || String(portId),
      unit: current.unit || current.unitId || 1,
      adminState: enabled ? 1 : 0,
      description: current.description || "",
      flowControl: current.flowControl || "Disable"
    };
    return this.post("swcfg_ports_ex", { switchPortConfig: { rows: [row] } });
  }

  async setPortDescription(portId, description, config) {
    const current = config || await this.firstRowFromPortConfig(portId);
    const portConfig = {
      portNum: [Number(portId)],
      description: description || ""
    };
    for (const key of [
      "adminState",
      "frameSize",
      "profileTemplate",
      "profileName",
      "physicalMode",
      "stpMode",
      "stpEdgeMode",
      "stpTcnGuard",
      "stpBPDUFilterMode",
      "broadcastStormControl",
      "speed",
      "duplexMode",
      "flowControl",
      "autonegotiation"
    ]) {
      if (current[key] !== undefined && current[key] !== "") {
        portConfig[key] = current[key];
      }
    }
    return this.post("swcfg_ports", { switchPortConfig: portConfig });
  }

  async setPoeEnabled(portId, enabled, config) {
    const current = config || await this.firstRowFromPoeConfig(portId);
    const legacyRow = this.legacyPoePayload(portId, current, { enable: enabled, reset: false });
    try {
      return await this.legacyPost("swcfg_poe", { poePortConfig: legacyRow }, { portid: String(portId) });
    } catch (error) {
      if (error instanceof NetgearProAvAuthError) {
        throw error;
      }
      return this.post("swcfg_poe", { poePortConfig: [this.poePayload(portId, current, { enable: enabled, reset: false })] }, { portid: String(portId) });
    }
  }

  async resetPoe(portId, config) {
    const current = config || await this.firstRowFromPoeConfig(portId);
    const legacyRow = this.legacyPoePayload(portId, current, { enable: true, reset: true });
    try {
      return await this.legacyPost("swcfg_poe", { poePortConfig: legacyRow }, { portid: String(portId) });
    } catch (error) {
      if (error instanceof NetgearProAvAuthError) {
        throw error;
      }
      return this.post("swcfg_poe", { poePortConfig: [this.poePayload(portId, current, { enable: true, reset: true })] }, { portid: String(portId) });
    }
  }

  poePayload(portId, config, options) {
    return dropEmpty({
      ...config,
      portNum: Number(portId),
      port: String(config.port || portId),
      enable: Boolean(options.enable),
      powerLimitMode: config.powerLimitMode ?? 1,
      classification: config.classification ?? config.poeClass ?? 0,
      currentPower: config.currentPower ?? config.powerUsage ?? 0,
      powerLimit: config.powerLimit ?? 32000,
      status: config.status ?? config.poeStatus ?? config.poeIsValid ?? 1,
      detectionType: config.detectionType ?? 2,
      priority: config.priority ?? 1,
      powerMode: config.powerMode ?? 3,
      schedule: config.schedule || "None",
      reset: Boolean(options.reset)
    });
  }

  legacyPoePayload(portId, config, options) {
    const payload = dropEmpty({
      ...config,
      portid: Number(config.portid || config.portNum || portId),
      enable: Boolean(options.enable),
      powerLimitMode: config.powerLimitMode ?? 1,
      classification: config.classification ?? config.poeClass ?? 0,
      currentPower: config.currentPower ?? config.powerUsage ?? 0,
      powerLimit: config.powerLimit ?? 32000,
      status: config.status ?? config.poeStatus ?? config.poeIsValid ?? 1,
      reset: Boolean(options.reset)
    });
    delete payload.portNum;
    delete payload.port;
    return payload;
  }

  async firstRowFromPortConfig(portId) {
    return firstRow(await this.portConfig(portId), portId);
  }

  async firstRowFromPoeConfig(portId) {
    return firstRow(await this.poePortConfig(portId), portId);
  }
}

function dropEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function firstRow(data, portId) {
  const rows = collectRows(data);
  const matching = rows.find((row) => {
    const candidate = row.portNum ?? row.portid ?? row.port ?? row.ifIndex;
    return String(candidate) === String(portId);
  });
  if (matching) {
    return matching;
  }
  if (rows[0]) {
    return rows[0];
  }
  throw new NetgearProAvResponseError(`no configuration row found for port ${portId}`);
}

function collectRows(value) {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRows);
  }
  const rows = [];
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "rows" && Array.isArray(item)) {
      rows.push(...item.filter((row) => row && typeof row === "object" && !Array.isArray(row)));
    } else if (item && typeof item === "object") {
      rows.push(...collectRows(item));
    }
  }
  return rows;
}

module.exports = {
  NetgearProAvClient,
  NetgearProAvError,
  NetgearProAvAuthError,
  NetgearProAvResponseError
};
