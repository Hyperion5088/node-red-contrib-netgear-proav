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
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== "") {
            url.searchParams.append(key, String(item));
          }
        }
      } else if (value !== undefined && value !== null && value !== "") {
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

  async portOptions() {
    const rows = collectRows(await this.portConfig());
    const options = [];
    const seen = new Set();
    for (const row of rows) {
      const id = row.portNum ?? row.portid ?? row.port ?? row.ifIndex;
      if (id === undefined || id === null || id === "") {
        continue;
      }
      const value = String(id);
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      const name = row.portStr || row.portName || row.name || row.interface || row.port || value;
      const description = row.description || row.alias || "";
      options.push({
        value,
        label: description ? `${name} - ${description}` : String(name),
        name: String(name),
        description: String(description)
      });
    }
    return options.sort(comparePortOptions);
  }

  async resolvePortId(portId) {
    const value = String(portId || "").trim();
    if (!value) {
      return value;
    }
    if (/^\d+$/.test(value)) {
      return value;
    }
    const ports = await this.portOptions();
    const match = ports.find((port) => {
      const candidates = [port.value, port.name, port.label].filter(Boolean).map((item) => String(item).trim());
      if (port.description) {
        candidates.push(`${port.name} - ${port.description}`.trim());
      }
      return candidates.includes(value);
    });
    return match ? match.value : value;
  }

  async requiredApiPortId(portId) {
    const resolved = await this.resolvePortId(portId);
    if (!/^\d+$/.test(String(resolved))) {
      throw new NetgearProAvResponseError(`could not resolve port ${portId} to an API port ID`);
    }
    return resolved;
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

  async portSummary() {
    const result = {
      ports: [null],
      portIds: [],
      physicalPortIds: [],
      portCount: 0,
      poeInfo: {},
      generatedAt: new Date().toISOString()
    };

    await this.mergePortSection(result, "config", () => this.portConfig(), { addPorts: true });
    result.physicalPortIds = [...result.portIds];
    await this.mergePortSection(result, "status", () => this.portsStatus());
    await this.mergePortSection(result, "state", () => this.portStatus());
    await this.mergePortSection(result, "statisticsErrors", () => this.portStatistics("errors"));
    await this.mergePortSection(result, "statisticsInbound", () => this.portStatistics("inbound"));
    await this.mergePortSection(result, "statisticsOutbound", () => this.portStatistics("outbound"));
    await this.mergePortSection(result, "fiber", () => this.fiberOptics());
    await this.mergePortSection(result, "fiberDiagnostics", () => this.fiberOpticsDiag());
    await this.mergePortSection(result, "fiberEeprom", () => this.fiberOpticsEeprom());
    await this.mergePortSection(result, "neighbors", () => this.neighbors(), { array: true });
    await this.mergePortSection(result, "stp", () => this.stpPortInfo());
    await this.mergeMulticastSummary(result);

    try {
      const poeInfo = await this.poeInfo();
      const rows = collectRows(poeInfo);
      result.poeInfo = rows[0] || poeInfo.poeInfo || {};
    } catch (error) {
      result.poeInfoError = error.message;
    }

    if (switchPoeCapable(result.poeInfo)) {
      for (const portId of result.portIds) {
        try {
          const poeConfig = await this.poePortConfig(portId);
          const row = firstRowOrNull(poeConfig, portId);
          if (row) {
            this.portSummaryEntry(result, portId).poe = row;
          }
        } catch (error) {
          this.portSummaryEntry(result, portId).poeError = error.message;
        }
      }
    }

    result.portCount = result.portIds.length;
    return result;
  }

  async mergePortSection(summary, section, fetcher, options = {}) {
    try {
      const data = await fetcher();
      for (const row of collectRows(data)) {
        const portId = portIdFromRow(row);
        if (!Number.isInteger(portId) || portId < 1) {
          continue;
        }
        if (!options.addPorts && !summary.physicalPortIds.includes(portId)) {
          continue;
        }
        const entry = this.portSummaryEntry(summary, portId, row);
        if (options.array) {
          entry[section] = entry[section] || [];
          entry[section].push(row);
        } else {
          entry[section] = row;
        }
      }
    } catch (error) {
      summary[`${section}Error`] = error.message;
    }
  }

  async mergeMulticastSummary(summary) {
    try {
      const data = await this.multicastGroups({ pageSize: 9999 });
      const rows = data.multicastGroups?.rows || [];
      const rowsByPort = groupRows(rows, (row) => row.port, compareNumeric);
      for (const [port, portRows] of Object.entries(rowsByPort)) {
        const portId = Number(port);
        if (!Number.isInteger(portId) || !summary.physicalPortIds.includes(portId)) {
          continue;
        }
        const entry = this.portSummaryEntry(summary, portId);
        entry.multicast = {
          group_count: portRows.length,
          vlans: uniqueSorted(portRows.map((row) => row.vlanId), compareNumeric),
          groups: uniqueSorted(portRows.map((row) => row.multicastAddress), compareIpOrText),
          subscribers: uniqueSorted(portRows.map((row) => row.subscriberAddress), compareIpOrText),
          rows: portRows
        };
      }
    } catch (error) {
      summary.multicastError = error.message;
    }
  }

  portSummaryEntry(summary, portId, row) {
    const existing = summary.ports[portId] || { id: portId };
    if (row) {
      existing.name = existing.name || row.portStr || row.portName || row.name || row.interface || (row.port !== undefined ? String(row.port) : undefined);
      existing.description = existing.description || row.description || row.alias || undefined;
    }
    summary.ports[portId] = existing;
    if (!summary.portIds.includes(portId)) {
      summary.portIds.push(portId);
      summary.portIds.sort((left, right) => left - right);
    }
    return existing;
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

  stpConfig() {
    return this.get("stp_config");
  }

  stpPortInfo() {
    return this.get("stp_port_info");
  }

  async multicastGroups(options = {}) {
    const data = await this.get("multicast_groups", {
      indexPage: options.indexPage || 1,
      pageSize: options.pageSize || 9999,
      unit: options.unit || 1
    });
    const rows = collectRows(data).sort(compareMulticastRows);
    const multicastGroups = {
      rows,
      byPort: groupRows(rows, (row) => row.port, compareNumeric),
      byVlan: groupRows(rows, (row) => row.vlanId, compareNumeric),
      byGroup: groupRows(rows, (row) => row.multicastAddress, compareIpOrText)
    };
    return {
      ...data,
      multicastGroups
    };
  }

  multicastMode() {
    return this.get("multicast_mode");
  }

  dnsLookup(domainName) {
    return this.get("dns_lookup", { domainName });
  }

  pingTest(ipAddr) {
    return this.get("ping_test", { ipAddr });
  }

  traceTest(ipAddr) {
    return this.get("trace_test", { ipAddr });
  }

  cableTest(ports) {
    const portList = Array.isArray(ports) ? ports : String(ports || "").split(",");
    const cleanPorts = portList.map((port) => Number(String(port).trim())).filter((port) => Number.isInteger(port) && port > 0);
    if (!cleanPorts.length) {
      throw new NetgearProAvResponseError("ports is required for cableTest");
    }
    return this.get("cable_test", { ports: cleanPorts });
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
    const row = {
      ...current,
      port: String(current.port || portId),
      portNum: Number(portId),
      portStr: current.portStr || current.portName || String(portId),
      unit: current.unit || current.unitId || 1,
      adminState: current.adminState ?? 1,
      description: description || "",
      flowControl: current.flowControl || "Disable"
    };
    try {
      return await this.post("swcfg_ports_ex", { switchPortConfig: { rows: [row] } });
    } catch (error) {
      if (error instanceof NetgearProAvAuthError) {
        throw error;
      }
    }

    const portConfig = {
      portNum: [Number(portId)],
      lagId: current.lagId !== undefined ? [Number(current.lagId)] : [],
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
    const candidate = portIdFromRow(row);
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

function firstRowOrNull(data, portId) {
  const rows = collectRows(data);
  return rows.find((row) => String(portIdFromRow(row)) === String(portId)) || rows[0] || null;
}

function portIdFromRow(row) {
  const value = row.portNum ?? row.portid ?? row.portId ?? row.ifIndex ?? row.port;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function collectRows(value) {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRows);
  }
  const rows = [];
  if (
    value.portNum !== undefined ||
    value.portid !== undefined ||
    value.ifIndex !== undefined ||
    (value.port !== undefined && typeof value.port !== "object")
  ) {
    rows.push(value);
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "rows" && Array.isArray(item)) {
      rows.push(...item.filter((row) => row && typeof row === "object" && !Array.isArray(row)));
    } else if (item && typeof item === "object") {
      rows.push(...collectRows(item));
    }
  }
  return rows;
}

function switchPoeCapable(poeInfo) {
  if (!poeInfo || typeof poeInfo !== "object") {
    return false;
  }
  for (const key of ["totalPowerAvailable", "availablePower", "thresholdPower", "consumedPower"]) {
    const value = Number(poeInfo[key]);
    if (Number.isFinite(value) && value > 0) {
      return true;
    }
  }
  return false;
}

function comparePortOptions(left, right) {
  const leftNum = Number(left.value);
  const rightNum = Number(right.value);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return leftNum - rightNum;
  }
  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
}

function compareMulticastRows(left, right) {
  return compareNumeric(left.port, right.port) ||
    compareNumeric(left.vlanId, right.vlanId) ||
    compareIpOrText(left.multicastAddress, right.multicastAddress) ||
    compareIpOrText(left.subscriberAddress, right.subscriberAddress) ||
    compareText(left.subscriberMacAddress, right.subscriberMacAddress) ||
    compareText(left.type, right.type);
}

function groupRows(rows, keyFn, compareFn = compareText) {
  const groups = rows.reduce((accumulator, row) => {
    const key = keyFn(row);
    if (key !== undefined && key !== null && key !== "") {
      const normalized = String(key);
      accumulator[normalized] = accumulator[normalized] || [];
      accumulator[normalized].push(row);
    }
    return accumulator;
  }, {});
  return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => compareFn(left, right)));
}

function uniqueSorted(values, compareFn) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== "").map((value) => String(value)))]
    .sort(compareFn);
}

function compareNumeric(left, right) {
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  if (Number.isFinite(leftNum) && !Number.isFinite(rightNum)) {
    return -1;
  }
  if (!Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return 1;
  }
  return compareText(left, right);
}

function compareIpOrText(left, right) {
  const leftIp = parseIpv4(left);
  const rightIp = parseIpv4(right);
  if (leftIp && rightIp) {
    for (let index = 0; index < leftIp.length; index += 1) {
      if (leftIp[index] !== rightIp[index]) {
        return leftIp[index] - rightIp[index];
      }
    }
    return 0;
  }
  if (leftIp && !rightIp) {
    return -1;
  }
  if (!leftIp && rightIp) {
    return 1;
  }
  return compareText(left, right);
}

function parseIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) {
    return null;
  }
  const parsed = parts.map((part) => Number(part));
  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parsed : null;
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true, sensitivity: "base" });
}

module.exports = {
  NetgearProAvClient,
  NetgearProAvError,
  NetgearProAvAuthError,
  NetgearProAvResponseError
};
