'use strict';

class UpdateAPIGatewayIntegrationTimeout {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'after:deploy:deploy': this.updateIntegrationTimeout.bind(this),
    };
    
    this.provider = this.serverless.getProvider('aws');
  }

  async updateIntegrationTimeout() {
    const service = this.serverless.service;
    const stage = this.options.stage || service.provider.stage;
    const region = this.options.region || service.provider.region;
    
    // Check if custom API Gateway ID is provided
    const customApiId = service.custom?.apiGatewayId;
    
    // Get the requested timeout value - check both serverless.custom and provider config
    let requestedTimeout;
    
    // First try to get from custom.apiGatewayIntegrationTimeout
    if (service.custom?.apiGatewayIntegrationTimeout !== undefined) {
      requestedTimeout = service.custom.apiGatewayIntegrationTimeout;
    } 
    // Then check if provider.timeout is set (in seconds)
    else if (service.provider?.timeout !== undefined) {
      // Provider timeout is in seconds, convert to milliseconds
      requestedTimeout = service.provider.timeout * 1000;
      this.serverless.cli.log(`Using provider.timeout value (${service.provider.timeout}s) converted to ${requestedTimeout}ms`);
    } 
    // Fallback to default
    else {
      requestedTimeout = 29000;
    }
    
    // Get the max timeout from custom settings or default to 29000 (AWS standard max)
    const maxTimeout = service.custom?.apiGatewayMaxTimeout || 29000; 
    
    // Start with the requested timeout
    let timeout = requestedTimeout;
    
    // Validate timeout is within AWS limits
    if (timeout < 50) {
      this.serverless.cli.log(`Warning: Minimum allowed timeout is 50 ms. Setting to minimum.`);
      timeout = 50;
    }
    
    // Check if timeout is above the maximum allowed by account's service quota
    if (timeout > maxTimeout) {
      this.serverless.cli.log(`Warning: Your requested timeout (${timeout} ms) exceeds the maximum allowed by your account's service quota (${maxTimeout} ms). Setting to maximum allowed.`);
      this.serverless.cli.log(`To increase this limit, request a service quota increase in the AWS console: https://console.aws.amazon.com/servicequotas/`);
      timeout = maxTimeout;
    }
    
    // Warn for values above 29000 ms, as they might require account throttle quota adjustments
    if (timeout > 29000) {
      this.serverless.cli.log(`Notice: You're setting a timeout above the standard 29000 ms (${timeout} ms). This is only possible if your account has the appropriate service quota.`);
    }
    
    this.serverless.cli.log(`Updating API Gateway integration timeout to ${timeout} ms`);
    
    try {
      // Use custom API ID if provided
      let restApiId = customApiId;
      
      if (!restApiId) {
        // Get the REST API ID from CloudFormation or API Gateway
        const stackName = `${service.service}-${stage}`;
        const describeStacksParams = {
          StackName: stackName,
        };
        
        // Try to get API ID from CloudFormation stack
        try {
          const result = await this.provider.request(
            'CloudFormation',
            'describeStacks',
            describeStacksParams,
            { region }
          );
          
          if (result.Stacks && result.Stacks[0] && result.Stacks[0].Outputs) {
            const restApiOutput = result.Stacks[0].Outputs.find(
              (output) => output.OutputKey.includes('RestApiId') || output.OutputKey.includes('ApiGatewayRestApi')
            );
            
            if (restApiOutput) {
              restApiId = restApiOutput.OutputValue;
              this.serverless.cli.log(`Found API ID from CloudFormation stack: ${restApiId}`);
            }
          }
        } catch (error) {
          this.serverless.cli.log(`Error retrieving stack information: ${error.message}`);
        }
        
        // If not found in CloudFormation, try to get from API Gateway
        if (!restApiId) {
          try {
            this.serverless.cli.log('API ID not found in CloudFormation outputs, trying to find from API Gateway...');
            
            const apis = await this.provider.request(
              'APIGateway',
              'getRestApis',
              {},
              { region }
            );
            
            // Try to find the API by name (service-stage)
            const apiName = `${service.service}-${stage}`;
            const api = apis.items.find(item => item.name === apiName);
            
            if (api) {
              restApiId = api.id;
              this.serverless.cli.log(`Found API ID from API Gateway: ${restApiId}`);
            } else {
              throw new Error(`Could not find API with name: ${apiName}`);
            }
          } catch (error) {
            throw new Error(`Could not find REST API ID: ${error.message}`);
          }
        }
      } else {
        this.serverless.cli.log(`Using provided API Gateway ID: ${restApiId}`);
      }
      
      // Get the API Gateway resources
      const apiGatewayResources = await this.provider.request(
        'APIGateway',
        'getResources',
        { restApiId },
        { region }
      );
      
      // For each resource, update all methods
      let updateCount = 0;
      for (const resource of apiGatewayResources.items) {
        if (resource.resourceMethods) {
          for (const method of Object.keys(resource.resourceMethods)) {
            const getMethodParams = {
              restApiId,
              resourceId: resource.id,
              httpMethod: method,
            };
            
            const methodDetails = await this.provider.request(
              'APIGateway',
              'getMethod',
              getMethodParams,
              { region }
            );
            
            if (methodDetails.methodIntegration) {
              const updateIntegrationParams = {
                restApiId,
                resourceId: resource.id,
                httpMethod: method,
                patchOperations: [
                  {
                    op: 'replace',
                    path: '/timeoutInMillis',
                    value: `${timeout}`,
                  },
                ],
              };
              
              try {
                await this.provider.request(
                  'APIGateway',
                  'updateIntegration',
                  updateIntegrationParams,
                  { region }
                );
                
                updateCount++;
                this.serverless.cli.log(`Updated timeout for ${method} on resource ${resource.path}`);
              } catch (error) {
                if (error.message && error.message.includes('between 50 ms and')) {
                  const match = error.message.match(/between 50 ms and (\d+) ms/);
                  if (match && match[1]) {
                    const actualMaxTimeout = parseInt(match[1], 10);
                    this.serverless.cli.log(`ERROR: Your account's maximum allowed timeout is ${actualMaxTimeout} ms.`);
                    this.serverless.cli.log(`Please update your configuration with: apiGatewayMaxTimeout: ${actualMaxTimeout}`);
                    throw new Error(`Timeout exceeds your account's service quota limit of ${actualMaxTimeout} ms`);
                  }
                }
                throw error;
              }
            }
          }
        }
      }
      
      if (updateCount === 0) {
        this.serverless.cli.log('No API Gateway integrations found to update');
        return;
      }
      
      // Create a new deployment to apply changes
      const createDeploymentParams = {
        restApiId,
        stageName: stage,
        description: `Updated integration timeout to ${timeout} ms`,
      };
      
      await this.provider.request(
        'APIGateway',
        'createDeployment',
        createDeploymentParams,
        { region }
      );
      
      this.serverless.cli.log(`Successfully updated ${updateCount} API Gateway integration(s) with timeout: ${timeout} ms`);
    } catch (error) {
      this.serverless.cli.log(`Error updating API Gateway integration timeout: ${error.message}`);
      throw error;
    }
  }
}

module.exports = UpdateAPIGatewayIntegrationTimeout;