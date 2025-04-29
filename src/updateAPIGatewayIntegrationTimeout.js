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
    
    // As of June 2024, AWS announced increased timeout limits beyond 29 seconds
    // Default to 120,000 ms (120 seconds) if not specified
    let timeout = service.custom?.apiGatewayIntegrationTimeout || 120000; 
    
    // Validate timeout is within AWS limits
    if (timeout < 50) {
      this.serverless.cli.log(`Warning: Minimum allowed timeout is 50 ms. Setting to minimum.`);
      timeout = 50;
    }
    
    // Warn for values above 29000 ms, as they might require account throttle quota adjustments
    if (timeout > 29000) {
      this.serverless.cli.log(`Notice: You're setting a timeout above 29000 ms (${timeout} ms). This is supported for Regional and Private REST APIs as of June 2024, but may require a reduction in your account-level throttle quota limit.`);
    }
    
    this.serverless.cli.log(`Updating API Gateway integration timeout to ${timeout} ms`);
    
    try {
      // Get the REST API ID
      const stackName = `${service.service}-${stage}`;
      const describeStacksParams = {
        StackName: stackName,
      };
      
      const result = await this.provider.request(
        'CloudFormation',
        'describeStacks',
        describeStacksParams,
        { region }
      );
      
      const restApiOutput = result.Stacks[0].Outputs.find(
        (output) => output.OutputKey.includes('RestApiId') || output.OutputKey.includes('ApiGatewayRestApi')
      );
      
      if (!restApiOutput) {
        throw new Error('Could not find REST API ID in CloudFormation stack outputs');
      }
      
      const restApiId = restApiOutput.OutputValue;
      
      // Get the API Gateway resources
      const apiGatewayResources = await this.provider.request(
        'APIGateway',
        'getResources',
        { restApiId },
        { region }
      );
      
      // For each resource, update all methods
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
              
              await this.provider.request(
                'APIGateway',
                'updateIntegration',
                updateIntegrationParams,
                { region }
              );
              
              this.serverless.cli.log(`Updated timeout for ${method} on resource ${resource.path}`);
            }
          }
        }
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
      
      this.serverless.cli.log('Successfully updated API Gateway integration timeout');
    } catch (error) {
      this.serverless.cli.log(`Error updating API Gateway integration timeout: ${error.message}`);
      throw error;
    }
  }
}

module.exports = UpdateAPIGatewayIntegrationTimeout;