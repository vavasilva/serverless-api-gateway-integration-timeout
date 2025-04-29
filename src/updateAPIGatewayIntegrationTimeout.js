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
    this.serverless.cli.log('================== API Gateway Timeout Update ==================');
    
    const service = this.serverless.service;
    const stage = this.options.stage || service.provider.stage;
    const region = this.options.region || service.provider.region;
    
    this.serverless.cli.log('Checking for custom API Gateway timeout settings...');
    
    // Diagnostic information
    const customSection = service.custom || {};
    this.serverless.cli.log(`service.custom: ${JSON.stringify(customSection)}`);
    
    // Check if custom API Gateway ID is provided
    const customApiId = customSection.apiGatewayId;
    
    // Get the requested timeout value with extensive debugging
    let requestedTimeout = null;
    
    // Try to get from custom.apiGatewayIntegrationTimeout with detailed logging
    if (customSection.apiGatewayIntegrationTimeout !== undefined) {
      this.serverless.cli.log(`Found custom.apiGatewayIntegrationTimeout: ${customSection.apiGatewayIntegrationTimeout}`);
      requestedTimeout = parseInt(customSection.apiGatewayIntegrationTimeout, 10);
      this.serverless.cli.log(`Parsed value: ${requestedTimeout}`);
    } else {
      this.serverless.cli.log('No custom.apiGatewayIntegrationTimeout found');
    }
    
    // If not set via custom, check provider timeout
    if (requestedTimeout === null && service.provider && service.provider.timeout !== undefined) {
      this.serverless.cli.log(`Using provider.timeout: ${service.provider.timeout} seconds`);
      // Provider timeout is in seconds, convert to milliseconds
      requestedTimeout = parseInt(service.provider.timeout, 10) * 1000;
      this.serverless.cli.log(`Converted to milliseconds: ${requestedTimeout}ms`);
    }
    
    // Fallback to default if still not set
    if (requestedTimeout === null) {
      requestedTimeout = 29000;
      this.serverless.cli.log(`No timeout configuration found, using default: ${requestedTimeout}ms`);
    }
    
    // Get the max timeout with detailed logging
    let maxTimeout = 29000; // AWS standard default
    
    if (customSection.apiGatewayMaxTimeout !== undefined) {
      this.serverless.cli.log(`Found custom.apiGatewayMaxTimeout: ${customSection.apiGatewayMaxTimeout}`);
      const parsedMax = parseInt(customSection.apiGatewayMaxTimeout, 10);
      if (!isNaN(parsedMax)) {
        maxTimeout = parsedMax;
        this.serverless.cli.log(`Using configured max timeout: ${maxTimeout}ms`);
      } else {
        this.serverless.cli.log(`WARNING: Invalid custom.apiGatewayMaxTimeout value: ${customSection.apiGatewayMaxTimeout}, using default`);
      }
    } else {
      this.serverless.cli.log(`No custom.apiGatewayMaxTimeout found, using default: ${maxTimeout}ms`);
    }
    
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
    
    // Final timeout value to use
    this.serverless.cli.log(`Final timeout value to use: ${timeout} ms`);
    
    // Warn for values above 29000 ms, as they might require account throttle quota adjustments
    if (timeout > 29000) {
      this.serverless.cli.log(`Notice: You're setting a timeout above the standard 29000 ms. This is only possible if your account has the appropriate service quota.`);
    }
    
    this.serverless.cli.log(`Updating API Gateway integration timeout to ${timeout} ms`);
    
    try {
      // Use custom API ID if provided
      let restApiId = customApiId;
      
      if (!restApiId) {
        // Get the REST API ID from CloudFormation or API Gateway
        const stackName = `${service.service}-${stage}`;
        this.serverless.cli.log(`Searching for API in CloudFormation stack: ${stackName}`);
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
            } else {
              this.serverless.cli.log('No API ID found in CloudFormation outputs');
            }
          } else {
            this.serverless.cli.log('No CloudFormation stack outputs found');
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
            
            if (apis.items.length === 0) {
              this.serverless.cli.log('No REST APIs found in the account');
              throw new Error('No REST APIs found in the account');
            }
            
            // Try to find the API by name (service-stage)
            const apiName = `${service.service}-${stage}`;
            this.serverless.cli.log(`Searching for API with name: ${apiName}`);
            
            const api = apis.items.find(item => item.name === apiName);
            
            if (api) {
              restApiId = api.id;
              this.serverless.cli.log(`Found API ID from API Gateway: ${restApiId}`);
            } else {
              // If exact match not found, try a less strict approach
              this.serverless.cli.log('Exact API name match not found, trying partial match');
              const partialMatches = apis.items.filter(item => 
                item.name.includes(service.service) && item.name.includes(stage)
              );
              
              if (partialMatches.length > 0) {
                restApiId = partialMatches[0].id;
                this.serverless.cli.log(`Found API ID by partial match: ${restApiId} (Name: ${partialMatches[0].name})`);
              } else {
                // If we have just one API, use it
                if (apis.items.length === 1) {
                  restApiId = apis.items[0].id;
                  this.serverless.cli.log(`Only one API found in account, using it: ${restApiId} (Name: ${apis.items[0].name})`);
                } else {
                  throw new Error(`Could not find API with name: ${apiName}`);
                }
              }
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
      
      if (!apiGatewayResources.items || apiGatewayResources.items.length === 0) {
        this.serverless.cli.log('No resources found for this API');
        return;
      }
      
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
              // Update the timeout
              try {
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
      this.serverless.cli.log('=========== API Gateway Timeout Update Complete ===========');
    } catch (error) {
      this.serverless.cli.log(`Error updating API Gateway integration timeout: ${error.message}`);
      throw error;
    }
  }
}

module.exports = UpdateAPIGatewayIntegrationTimeout;