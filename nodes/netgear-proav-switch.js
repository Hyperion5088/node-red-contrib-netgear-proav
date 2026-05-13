"use strict";

const { NetgearProAvAuthError, NetgearProAvClient } = require("../lib/client");

const OPERATIONS = {
  deviceInfo: (client) => client.deviceInfo(),
  portConfig: async (client, msg, node) => client.portConfig(await requiredApiPortId(client, msg, node)),
  portConfigAll: (client) => client.portConfig(),
  portSummary: (client) => client.portSummary(),
  portsStatus: (client) => client.portsStatus(),
  portStatus: (client) => client.portStatus(),
  portStatistics: (client, msg, node) => client.portStatistics(msg.statisticsType || msg.payload?.statisticsType || node.statisticsType || "errors"),
  fiberOptics: (client) => client.fiberOptics(),
  fiberOpticsDiag: (client) => client.fiberOpticsDiag(),
  fiberOpticsEeprom: (client) => client.fiberOpticsEeprom(),
  stpConfig: (client) => client.stpConfig(),
  stpPortInfo: (client) => client.stpPortInfo(),
  multicastGroups: (client, msg, node) => client.multicastGroups({
    indexPage: msg.indexPage ?? msg.payload?.indexPage ?? node.indexPage,
    pageSize: msg.pageSize ?? msg.payload?.pageSize ?? node.pageSize,
    unit: msg.unit ?? msg.payload?.unit ?? node.unit
  }),
  multicastMode: (client) => client.multicastMode(),
  dnsLookup: (client, msg, node) => client.dnsLookup(requiredValue(msg.domainName ?? msg.payload?.domainName ?? node.domainName, "domainName")),
  pingTest: (client, msg, node) => client.pingTest(requiredValue(msg.ipAddr ?? msg.payload?.ipAddr ?? node.ipAddr, "ipAddr")),
  traceTest: (client, msg, node) => client.traceTest(requiredValue(msg.ipAddr ?? msg.payload?.ipAddr ?? node.ipAddr, "ipAddr")),
  cableTest: (client, msg, node) => client.cableTest(requiredValue(msg.ports ?? msg.payload?.ports ?? node.ports, "ports")),
  imageInfo: (client) => client.imageInfo(),
  configStatus: (client) => client.configStatus(),
  neighbors: (client) => client.neighbors(),
  profileList: (client) => client.profileList(),
  poeInfo: (client) => client.poeInfo(),
  poePortConfig: async (client, msg, node) => client.poePortConfig(await requiredApiPortId(client, msg, node)),
  lagConfig: (client) => client.lagConfig(),
  stacking: (client) => client.stacking(),
  vlanMembership: (client, msg, node) => client.vlanMembership(requiredValue(msg.vlanId ?? msg.payload?.vlanId ?? node.vlanId, "vlanId")),
  saveConfig: (client) => client.saveConfig(),
  reboot: (client, msg, node) => client.reboot(msg.save ?? msg.payload?.save ?? node.saveOnReboot),
  setFanMode: (client, msg, node) => client.setFanMode(requiredValue(msg.fanMode ?? msg.payload?.fanMode ?? node.fanMode, "fanMode")),
  setPortAdmin: async (client, msg, node) => client.setPortAdminState(await requiredApiPortId(client, msg, node), requiredBoolean(msg, node), msg.config || msg.payload?.config),
  setPortDescription: async (client, msg, node) => client.setPortDescription(await requiredApiPortId(client, msg, node), msg.description ?? msg.payload?.description ?? node.description ?? "", msg.config || msg.payload?.config),
  setPoeEnabled: async (client, msg, node) => client.setPoeEnabled(await requiredApiPortId(client, msg, node), requiredBoolean(msg, node), msg.config || msg.payload?.config),
  resetPoe: async (client, msg, node) => client.resetPoe(await requiredApiPortId(client, msg, node), msg.config || msg.payload?.config)
};

module.exports = function registerNetgearProAvNodes(RED) {
  function NetgearProAvSwitchConfigNode(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.host = config.host;
    this.port = Number(config.port || 443);
    this.verifySsl = Boolean(config.verifySsl);
    this.timeout = Number(config.timeout || 15000);

    this.client = new NetgearProAvClient({
      host: this.host,
      port: this.port,
      verifySsl: this.verifySsl,
      timeout: this.timeout,
      username: this.credentials.username,
      password: this.credentials.password
    });

    this.portOptions = async () => this.client.portOptions();

    this.execute = async (operation, msg, actionNode) => {
      const handler = OPERATIONS[operation];
      if (!handler) {
        throw new Error(`unsupported NETGEAR Pro AV operation: ${operation}`);
      }
      return handler(this.client, msg, actionNode);
    };

    this.switchInfo = () => ({
      host: this.host,
      name: this.name || this.host,
      port: this.port
    });

    this.on("close", async (removed, done) => {
      try {
        await this.client.logout();
      } catch (error) {
        this.warn(error.message);
      }
      done();
    });
  }

  RED.nodes.registerType("netgear-proav-switch", NetgearProAvSwitchConfigNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" }
    }
  });

  RED.httpAdmin.get("/netgear-proav/switch/:id/ports", RED.auth.needsPermission("netgear-proav-control.read"), async (req, res) => {
    const switchNode = RED.nodes.getNode(req.params.id);
    if (!switchNode || typeof switchNode.portOptions !== "function") {
      res.status(404).json({ error: "NETGEAR Pro AV switch config not found" });
      return;
    }
    try {
      res.json({ ports: await switchNode.portOptions() });
    } catch (error) {
      res.status(error instanceof NetgearProAvAuthError ? 401 : 500).json({ error: error.message });
    }
  });

  function NetgearProAvControlNode(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.switch = RED.nodes.getNode(config.switch);
    this.operation = config.operation || "deviceInfo";
    this.portId = config.portId;
    this.enabled = config.enabled;
    this.description = config.description;
    this.fanMode = config.fanMode;
    this.vlanId = config.vlanId;
    this.statisticsType = config.statisticsType || "errors";
    this.domainName = config.domainName;
    this.ipAddr = config.ipAddr;
    this.ports = config.ports;
    this.indexPage = config.indexPage;
    this.pageSize = config.pageSize;
    this.unit = config.unit;
    this.saveOnReboot = config.saveOnReboot !== false;

    this.on("input", async (msg, send, done) => {
      if (!this.switch) {
        const error = new Error("NETGEAR Pro AV switch config is missing");
        this.status({ fill: "red", shape: "ring", text: "missing switch" });
        done(error);
        return;
      }

      const operation = msg.operation || this.operation;
      this.status({ fill: "blue", shape: "dot", text: operation });
      try {
        const result = await this.switch.execute(operation, msg, this);
        msg.operation = operation;
        msg.switch = this.switch.switchInfo();
        msg.payload = result;
        this.status({ fill: "green", shape: "dot", text: "ok" });
        send(msg);
        done();
      } catch (error) {
        this.status({
          fill: error instanceof NetgearProAvAuthError ? "yellow" : "red",
          shape: "ring",
          text: error.message
        });
        done(error);
      }
    });
  }

  RED.nodes.registerType("netgear-proav-control", NetgearProAvControlNode);
};

function requiredPortId(msg, node) {
  return requiredValue(msg.portId ?? msg.payload?.portId ?? node.portId, "portId");
}

async function requiredApiPortId(client, msg, node) {
  return client.requiredApiPortId(requiredPortId(msg, node));
}

function requiredBoolean(msg, node) {
  const value = msg.enabled ?? msg.payload?.enabled ?? node.enabled;
  if (value === true || value === "true" || value === "1" || value === 1 || value === "on") {
    return true;
  }
  if (value === false || value === "false" || value === "0" || value === 0 || value === "off") {
    return false;
  }
  throw new Error("enabled must be true or false");
}

function requiredValue(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
