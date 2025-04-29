'use strict';

/**
 * Serverless API Gateway Integration Timeout Plugin
 * Based on the solution provided by johan1252 in GitHub issue:
 * https://github.com/serverless/serverless/issues/12800#issuecomment-2357708720
 */

const assert = require("node:assert");
const Klass = require("serverless/lib/plugins/aws/package/compile/events/api-gateway");

class IntegrationTimeout {
    constructor(serverless, options) {
        serverless.configSchemaHandler.defineFunctionEventProperties("aws", "http", {
            properties: {
                timeout: { type: "number" }
            }
        });

        this.serverless = serverless;
        this.options = options;
        const instance = serverless.pluginManager.plugins.find(
            plugin => plugin.constructor.name === Klass.name
        );
        assert.ok(instance, `Could not find instance of ${Klass.name}`);
        const original = instance.getMethodIntegration;
        instance.getMethodIntegration = function (http, { lambdaLogicalId, lambdaAliasName }) {
            const integration = original.call(instance, http, {
                lambdaLogicalId,
                lambdaAliasName
            });
            const type = http.integration || "AWS_PROXY";
            if (http.timeout) {
                if (type === "AWS" || type === "LAMBDA" || type === "AWS_PROXY") {
                    integration.Properties.Integration.TimeoutInMillis = http.timeout * 1000;
                }
            }
            return integration;
        };
    }
}

module.exports = IntegrationTimeout;