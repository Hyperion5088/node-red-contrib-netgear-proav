"use strict";

const { NetgearProAvAuthError, NetgearProAvClient } = require("../lib/client");

const OPERATIONS = {
  deviceInfo: (client) => client.deviceInfo(),
  portConfig: (client, msg, node) => client.portConfig(requiredPortId(msg, node)),
  portConfigAll: (client) => client.portConfig(),
  portsStatus: (client) => client.portsStatus(),
  portStatus: (client) => client.portStatus(),
  portStatistics: (client, msg, node) => client.portStatistics(msg.statisticsType || node.statisticsType || "errors"),
  fiberOptics: (client) => client.fiberOptics(),
  fiberOpticsDiag: (client) => client.fiberOpticsDiag(),
  fiberOpticsEeprom: (client) => client.fiberOpticsEeprom(),
  imageInfo: (client) => client.imageInfo(),
  neighbors: (client) => client.neighbors(),
  profileList: (client) => client.profileList(),
  poeInfo: (client) => client.poeInfo(),
  poePortConfig: (client, msg, node) => client.poePortConfig(requiredPortId(msg, node)),
  lagConfig: (client) => client.lagConfig(),
  stacking: (client) => client.stacking(),
  vlanMembership: (client, msg, node) => client.vlanMembership(requiredValue(msg.vlanId ?? msg.payload?.vlanId ?? node.vlanId, "vlanId")),
  saveConfig: (client) => client.saveConfig(),
  reboot: (client, msg, node) => client.reboot(msg.save ?? msg.payload?.save ?? node.saveOnReboot),
  setFanMode: (client, msg, node) => client.setFanMode(requiredValue(msg.fanMode ?? msg.payload?.fanMode ?? node.fanMode, "fanMode")),
  setPortAdmin: (client, msg, node) => client.setPortAdminState(requiredPortId(msg, node), requiredBoolean(msg, node), msg.config || msg.payload?.config),
  setPortDescription: (client, msg, node) => client.setPortDescription(requiredPortId(msg, node), msg.description ?? msg.payload?.description ?? node.description ?? "", msg.config || msg.payload?.config),
  setPoeEnabled: (client, msg, node) => client.setPoeEnabled(requiredPortId(msg, node), requiredBoolean(msg, node), msg.config || msg.payload?.config),
  resetPoe: (client, msg, node) => client.resetPoe(requiredPortId(msg, node), msg.config || msg.payload?.config)
};

module.exports = function registerNetgearProAvSwitch(RED) {
  function NetgearProAvSwitchNode(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.host = config.host;
    this.port = Number(config.port || 443);
    this.verifySsl = Boolean(config.verifySsl);
    this.timeout = Number(config.timeout || 15000);
    this.operation = config.operation || "deviceInfo";
    this.portId = config.portId;
    this.enabled = config.enabled;
    this.description = config.description;
    this.fanMode = config.fanMode;
    this.vlanId = config.vlanId;
    this.statisticsType = config.statisticsType || "errors";
    this.saveOnReboot = config.saveOnReboot !== false;

    this.client = new NetgearProAvClient({
      host: this.host,
      port: this.port,
      verifySsl: this.verifySsl,
      timeout: this.timeout,
      username: this.credentials.username,
      password: this.credentials.password
    });

    this.on("input", async (msg, send, done) => {
      const operation = msg.operation || this.operation;
      const handler = OPERATIONS[operation];
      if (!handler) {
        const error = new Error(`unsupported NETGEAR Pro AV operation: ${operation}`);
        this.status({ fill: "red", shape: "ring", text: "bad operation" });
        done(error);
        return;
      }

      this.status({ fill: "blue", shape: "dot", text: operation });
      try {
        const result = await handler(this.client, msg, this);
        msg.operation = operation;
        msg.switch = {
          host: this.host,
          name: this.name || this.host
        };
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

    this.on("close", async (removed, done) => {
      try {
        await this.client.logout();
      } catch (error) {
        this.warn(error.message);
      }
      done();
    });
  }

  RED.nodes.registerType("netgear-proav-switch", NetgearProAvSwitchNode, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" }
    }
  });
};

function requiredPortId(msg, node) {
  return requiredValue(msg.portId ?? msg.payload?.portId ?? node.portId, "portId");
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
