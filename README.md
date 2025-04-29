# Serverless API Gateway Integration Timeout

A Serverless Framework plugin to modify the API Gateway integration timeout based on your AWS account's service quota.

## Problem

By default, Amazon API Gateway has an integration timeout limit of 29 seconds (29,000 milliseconds). This can be too short for more complex or resource-intensive operations, especially for Generative AI workloads with Large Language Models (LLMs).

As [announced in June 2024](https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-api-gateway-integration-timeout-limit-29-seconds/), AWS now allows integration timeouts beyond 29 seconds for Regional and Private REST APIs, making it possible to support longer-running backend operations.

## Solution

This plugin automatically updates the API Gateway integration timeout after deployment, allowing you to set integration timeout values for your API Gateway based on your account's service quota.

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
  apiGatewayIntegrationTimeout: 60000  # Desired timeout in milliseconds
  apiGatewayMaxTimeout: 60000  # Maximum timeout allowed by your AWS account's service quota
```

You can also set just the Lambda timeout in the provider section, and the plugin will automatically use that value (converted to milliseconds):

```yaml
provider:
  timeout: 60  # Lambda timeout in seconds - will be used as 60000ms for API Gateway
```

If no timeout is specified, the plugin will default to a timeout of 29,000 milliseconds (29 seconds).

## Service Quota and Maximum Timeout

The maximum timeout value depends on your AWS account's service quota:

1. **Standard Limit**: 29,000 milliseconds (29 seconds)
2. **Extended Limit**: May be increased up to 60,000 milliseconds (60 seconds) or 120,000 milliseconds (120 seconds), depending on your account

To increase your service quota:
1. Go to the [AWS Service Quotas console](https://console.aws.amazon.com/servicequotas/)
2. Navigate to API Gateway service
3. Request an increase for the "Integration timeout" quota

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `apiGatewayIntegrationTimeout` | The desired timeout in milliseconds | 29000 or provider.timeout * 1000 |
| `apiGatewayMaxTimeout` | The maximum timeout allowed by your AWS account's service quota | 29000 |
| `apiGatewayId` | Optional: Manually specify your API Gateway ID | - |

## Timeout Order of Precedence

The plugin determines the timeout value to set in the following order:

1. `custom.apiGatewayIntegrationTimeout` if defined
2. `provider.timeout` * 1000 (converting from seconds to milliseconds) if defined
3. Default value of 29000ms if neither of the above is defined

## Troubleshooting

### Error: Timeout should be between 50 ms and 60000 ms

This error occurs when your requested timeout exceeds your account's service quota. To resolve this:

1. Check your current service quota in the AWS console
2. Set the `apiGatewayMaxTimeout` parameter to match your account's limit:

```yaml
custom:
  apiGatewayIntegrationTimeout: 60000  # Your desired timeout
  apiGatewayMaxTimeout: 60000  # Set to your account's maximum limit
```

The plugin will automatically adjust your timeout if it exceeds the maximum value.

### Error: Could not find REST API ID

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
  apiGatewayIntegrationTimeout: 60000  # Desired timeout
  apiGatewayId: abcdef123  # Your API Gateway ID
```

## Important Notes

- This plugin only works with full deployments (`serverless deploy`), as it needs to modify the API Gateway after deployment.
- The plugin runs during the `after:deploy:deploy` lifecycle hook.
- The default integration timeout in API Gateway is 29,000 milliseconds (29 seconds).
- Integration timeouts above 29 seconds require a service quota increase for your AWS account.
- The minimum integration timeout allowed by AWS is 50 milliseconds.
- After modifying the timeout, the plugin creates a new deployment to apply the changes.

## Example

Complete `serverless.yml` example:

```yaml
service: my-api

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1
  timeout: 60  # Lambda timeout in seconds - will also be used for API Gateway

plugins:
  - serverless-api-gateway-integration-timeout

custom:
  # Explicitly set API Gateway timeout if needed
  # apiGatewayIntegrationTimeout: 60000  # 60 seconds
  
  # Set the maximum allowed by your account's service quota
  apiGatewayMaxTimeout: 60000  # Your account's limit
  
  # Optional: Specify API Gateway ID manually if needed
  # apiGatewayId: abcdef123

functions:
  processData:
    handler: handler.processData
    timeout: 60  # Lambda timeout in seconds
    events:
      - http:
          path: /process
          method: post
          cors: true
```

## License

MIT