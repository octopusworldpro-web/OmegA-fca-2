"use strict";

const { createFacebookMqttClient } = require("./facebookMqttClient");
const { createGoatBotLogin } = require("./goatbotLogin");

/**
 * Builds the EryXen-style FCA login entry point around the native OmegA client.
 * AppState/SessionGuard authentication remains the supported native path.
 */
function createFcaLogin(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("FCA login options must be an object");
  }

  const { client: suppliedClient, ...clientOptions } = options;
  const client = suppliedClient || createFacebookMqttClient(clientOptions);
  const goatBotLogin = createGoatBotLogin(client);

  function login(credentials = {}, loginOptions = {}, callback) {
    if (typeof loginOptions === "function") {
      callback = loginOptions;
      loginOptions = {};
    }
    if (loginOptions == null) loginOptions = {};
    if (typeof loginOptions !== "object" || Array.isArray(loginOptions)) {
      throw new TypeError("FCA login options must be an object");
    }
    if (callback !== undefined && typeof callback !== "function") {
      throw new TypeError("FCA login callback must be a function");
    }

    if (typeof callback === "function") {
      return goatBotLogin(credentials, loginOptions, callback);
    }

    // Promise form rejects on authentication failure; callback form preserves
    // the legacy error-first callback and its (error, api) contract.
    return new Promise((resolve, reject) => {
      try {
        const operation = goatBotLogin(credentials, loginOptions, (error, api) => {
          if (error) reject(error);
          else resolve(api);
        });
        Promise.resolve(operation).catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  return Object.freeze({
    login,
    logout: callback => client.logout(callback),
    getConnectionState: () => client.getConnectionState(),
    getLicense: () => client.getLicense()
  });
}

module.exports = { createFcaLogin };
