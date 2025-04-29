# Serverless API Gateway Integration Timeout

A lightweight Serverless Framework plugin that adds support for setting API Gateway integration timeouts directly in HTTP events.

> This plugin was inspired by [serverless/serverless#12800](https://github.com/serverless/serverless/issues/12800#issuecomment-2357708720) and the solution provided by [johan1252](https://github.com/johan1252) and other contributors.

## Problem

By default, Amazon API Gateway has an integration timeout limit of 29 seconds (29,000 milliseconds). This can be too short for more complex or resource-intensive operations.

While Lambda functions can have longer timeout values (up to 15 minutes), API Gateway will terminate the request if it exceeds its integration timeout. The Serverless Framework doesn't natively support setting this timeout directly in HTTP event definitions.

## Solution

This plugin extends the Serverless Framework's HTTP event schema to include a `timeout` property. It intercepts the API Gateway CloudFormation template generation to add the `TimeoutInMillis` property to your integrations.

## Installation

```bash
# Using npm
npm install --save-dev serverless-api-gateway-integration-timeout

# Using Serverless plugin install
serverless plugin install -n serverless-api-gateway-integration-timeout
```

## Usage

1. Add the plugin to your `serverless.yml` file:

```yaml
plugins:
  - serverless-api-gateway-integration-timeout
```

2. Set the timeout directly in your HTTP events:

```yaml
functions:
  myFunction:
    handler: handler.myFunction
    timeout: 60  # Lambda timeout in seconds
    events:
      - http:
          path: /my-path
          method: get
          timeout: 60  # API Gateway timeout in seconds (converted to milliseconds)
```

## Important Notes

- The `timeout` value in HTTP events is in **seconds**. It will be automatically converted to milliseconds.
- The maximum allowed timeout depends on your AWS account's service quota limit
  - Standard limit: 29 seconds (29,000 milliseconds)
  - Extended limit: May be increased up to 60 or 120 seconds, depending on your account
- The plugin works with these integration types: `AWS`, `AWS_PROXY`, and `LAMBDA`
- The plugin modifies the CloudFormation template during deployment, so it only works with `serverless deploy`

## Service Quota and Maximum Timeout

The maximum timeout value depends on your AWS account's service quota:

1. **Standard Limit**: 29,000 milliseconds (29 seconds)
2. **Extended Limit**: May be increased up to 60,000 milliseconds (60 seconds) or 120,000 milliseconds (120 seconds), depending on your account

To increase your service quota:
1. Go to the [AWS Service Quotas console](https://console.aws.amazon.com/servicequotas/)
2. Navigate to API Gateway service
3. Request an increase for the "Integration timeout" quota

## How It Works

The plugin works by:

1. Extending the Serverless Framework's HTTP event schema to include a `timeout` property
2. Finding the API Gateway compiler plugin instance
3. Monkey-patching the `getMethodIntegration` method to include the `TimeoutInMillis` property when generating the CloudFormation template

This approach is lightweight and doesn't require any post-deployment modifications to the API Gateway.

## Example

Complete `serverless.yml` example:

```yaml
service: my-api

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1

plugins:
  - serverless-api-gateway-integration-timeout

functions:
  processingFunction:
    handler: handler.process
    timeout: 60  # Lambda timeout in seconds
    events:
      - http:
          path: /process
          method: post
          integration: AWS_PROXY
          timeout: 60  # API Gateway timeout in seconds
  
  reportFunction:
    handler: handler.report
    timeout: 29  # Lambda timeout in seconds
    events:
      - http:
          path: /report/{id}
          method: get
          timeout: 29  # API Gateway timeout in seconds
```

Example `handler.js`:

```javascript
'use strict';

module.exports.process = async (event) => {
  // This function can run for up to 60 seconds
  // API Gateway will wait for up to 60 seconds for a response
  await new Promise(resolve => setTimeout(resolve, 50000));
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Process completed successfully',
    }),
  };
};

module.exports.report = async (event) => {
  // This function can run for up to 29 seconds
  // API Gateway will wait for up to 29 seconds for a response
  await new Promise(resolve => setTimeout(resolve, 25000));
  
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