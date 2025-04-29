# Serverless API Gateway Integration Timeout

A Serverless Framework plugin to modify the API Gateway integration timeout.

## Problem

By default, Amazon API Gateway has an integration timeout limit of 29 seconds (29,000 milliseconds). This can be too short for more complex or resource-intensive operations, especially for Generative AI workloads with Large Language Models (LLMs).

As [announced in June 2024](https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-api-gateway-integration-timeout-limit-29-seconds/), AWS now allows integration timeouts beyond 29 seconds for Regional and Private REST APIs, making it possible to support longer-running backend operations.

## Solution

This plugin automatically updates the API Gateway integration timeout after deployment, allowing you to set higher timeout values (up to 120 seconds / 120,000 milliseconds) for your API Gateway integrations.

## Installation

```bash
# Using npm
npm install --save-dev serverless-api-gateway-integration-timeout

# Using Serverless plugin install
serverless plugin install -n serverless-api-gateway-integration-timeout
```

## Usage

Add the plugin to your `serverless.yml` file:

```yaml
plugins:
  - serverless-api-gateway-integration-timeout
```

Configure the timeout in the custom section of your `serverless.yml`:

```yaml
custom:
  apiGatewayIntegrationTimeout: 120000  # 120 seconds
```

If not specified, the plugin will default to 120,000 milliseconds (120 seconds).

## Troubleshooting

If you encounter the error `Could not find REST API ID in CloudFormation stack outputs`, this usually happens when:

1. You're using multiple API Gateway instances
2. You're using a custom naming convention for your API Gateway
3. Your serverless deployment doesn't use CloudFormation outputs for the API Gateway

The plugin will attempt to find your API Gateway by:
1. First checking the CloudFormation stack outputs for the API ID
2. If not found, it will try to find the API Gateway by its name (service-stage)

If it still cannot find your API Gateway, you can manually specify the API ID in your serverless.yml:

```yaml
custom:
  apiGatewayIntegrationTimeout: 120000  # 120 seconds
  apiGatewayId: abcdef123  # Your API Gateway ID
```

## Important Notes

- This plugin only works with full deployments (`serverless deploy`), as it needs to modify the API Gateway after deployment.
- The plugin runs during the `after:deploy:deploy` lifecycle hook.
- The default integration timeout in API Gateway is 29,000 milliseconds (29 seconds).
- Integration timeouts above 29 seconds are only supported for Regional and Private REST APIs (as of June 2024).
- Increasing the timeout above 29 seconds may require a reduction in your account-level throttle quota limit.
- The minimum integration timeout allowed by AWS is 50 milliseconds.
- After modifying the timeout, the plugin creates a new deployment to apply the changes.

## Example

Complete `serverless.yml` example:

```yaml
service: long-running-api

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1
  timeout: 120  # Default Lambda timeout in seconds

plugins:
  - serverless-api-gateway-integration-timeout

custom:
  apiGatewayIntegrationTimeout: 120000  # 120 seconds
  # apiGatewayId: abcdef123  # Optional: Specify API Gateway ID manually if needed

functions:
  processData:
    handler: handler.processData
    timeout: 60  # Lambda timeout in seconds
    events:
      - http:
          path: /process
          method: post
          cors: true
  
  generateReport:
    handler: handler.generateReport
    timeout: 120  # This Lambda has a longer timeout
    events:
      - http:
          path: /report/{id}
          method: get
          cors: true
```

Example `handler.js`:

```javascript
'use strict';

module.exports.processData = async (event) => {
  // Simulate a long-running process
  await new Promise(resolve => setTimeout(resolve, 50000));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Data processed successfully',
    }),
  };
};

module.exports.generateReport = async (event) => {
  // Simulate a long-running report generation
  await new Promise(resolve => setTimeout(resolve, 90000));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Report generated successfully',
      reportId: event.pathParameters.id,
    }),
  };
};
```

## License

MIT