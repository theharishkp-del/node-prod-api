export const REGISTRY_COLLECTION = 'sma_client_master';

export const registryCollectionSchema = {
  bsonType: 'object',
  required: ['botUserId', 'tenantId', 'databaseName', 'isActive', 'createdAt'],
  additionalProperties: true,
  properties: {
    botUserId: {
      bsonType: 'string',
      description: 'Primary key used to resolve the tenant from the master database.',
    },
    botId: {
      bsonType: ['string', 'null'],
      description: 'Bot identifier when available from botMasterKey.',
    },
    userId: {
      bsonType: ['string', 'null'],
      description: 'User identifier when available from botMasterKey.',
    },
    tenantId: {
      bsonType: 'string',
      description: 'Stable tenant identifier shared with tenant records.',
    },
    databaseName: {
      bsonType: 'string',
      description: 'Tenant database name mapped from the master registry.',
    },
    companyName: {
      bsonType: ['string', 'null'],
      description: 'Company name used for quick registry lookups and support visibility.',
    },
    planCode: {
      bsonType: ['string', 'null'],
      description: 'Resolved onboarding plan code used to enforce tenant user limits.',
    },
    invCustomerId: {
      bsonType: ['string', 'null'],
      description: 'Customer or organization identifier returned by the external inventory service.',
    },
    inventoryOrganization: {
      bsonType: ['object', 'null'],
      description: 'External inventory organization synchronization status and audit metadata.',
      properties: {
        status: { bsonType: ['string', 'null'] },
        invCustomerId: { bsonType: ['string', 'null'] },
        lastAttemptAt: { bsonType: ['date', 'null'] },
        syncedAt: { bsonType: ['date', 'null'] },
        lastError: { bsonType: ['string', 'null'] },
        responseCode: { bsonType: ['int', 'long', 'double', 'null'] },
      },
    },
    branches: {
      bsonType: 'array',
      description: 'Provisioned branch records stored for onboarding reference and branch-wise reporting.',
      items: {
        bsonType: 'object',
        required: ['branchId', 'branchName', 'address'],
        properties: {
          branchId: { bsonType: 'string' },
          branchName: { bsonType: 'string' },
          address: { bsonType: 'object' },
        },
      },
    },
    cybotUsers: {
      bsonType: 'array',
      description: 'Provisioned cybot users stored for onboarding reference.',
      items: {
        bsonType: 'object',
      },
    },
    botDetails: {
      bsonType: ['object', 'null'],
      description: 'Bot details fetched during initial onboarding and stored for later reference.',
    },
    botMasterKey: {
      bsonType: 'object',
      description: 'Decoded bot metadata used for tenant resolution.',
    },
    zohoBooks: {
      bsonType: ['object', 'null'],
      description: 'Zoho Books connection, organizations, OAuth tokens, and audit details for this tenant.',
      properties: {
        status: {
          bsonType: ['string', 'null'],
        },
        autoSyncEnabled: {
          bsonType: ['bool', 'null'],
        },
        scope: {
          bsonType: ['string', 'null'],
        },
        organizationConfig: {
          bsonType: ['object', 'null'],
          properties: {
            defaultOrganizationId: {
              bsonType: ['string', 'null'],
            },
          },
        },
        organizations: {
          bsonType: ['object', 'null'],
          properties: {
            availableOrganizations: {
              bsonType: ['array', 'null'],
              items: {
                bsonType: 'object',
                properties: {
                  organizationId: { bsonType: 'string' },
                  name: { bsonType: 'string' },
                  isDefault: { bsonType: 'bool' },
                  isActive: { bsonType: 'bool' },
                  currencyCode: { bsonType: ['string', 'null'] },
                  timeZone: { bsonType: ['string', 'null'] },
                },
              },
            },
            selectedOrganization: {
              bsonType: ['object', 'null'],
              properties: {
                organizationId: { bsonType: ['string', 'null'] },
                name: { bsonType: ['string', 'null'] },
              },
            },
            selectionRequired: {
              bsonType: ['bool', 'null'],
            },
            organizationLocked: {
              bsonType: ['bool', 'null'],
            },
          },
        },
        auth: {
          bsonType: ['object', 'null'],
          properties: {
            accessToken: { bsonType: ['string', 'null'] },
            refreshToken: { bsonType: ['string', 'null'] },
            apiDomain: { bsonType: ['string', 'null'] },
            tokenType: { bsonType: ['string', 'null'] },
            expiresInSeconds: { bsonType: ['int', 'long', 'double', 'null'] },
            accessTokenExpiresAt: { bsonType: ['date', 'null'] },
            accountsServer: { bsonType: ['string', 'null'] },
            redirectUri: { bsonType: ['string', 'null'] },
          },
        },
        audit: {
          bsonType: ['object', 'null'],
          properties: {
            connectedAt: { bsonType: ['date', 'null'] },
            updatedAt: { bsonType: ['date', 'null'] },
          },
        },
        importState: {
          bsonType: ['object', 'null'],
          properties: {
            status: { bsonType: ['string', 'null'] },
            startedAt: { bsonType: ['date', 'null'] },
            completedAt: { bsonType: ['date', 'null'] },
            lastError: { bsonType: ['string', 'null'] },
            modules: {
              bsonType: ['object', 'null'],
              additionalProperties: true,
            },
          },
        },
      },
    },
    isActive: {
      bsonType: 'bool',
      description: 'Soft-active flag for registry entries.',
    },
    createdAt: {
      bsonType: 'date',
    },
    updatedAt: {
      bsonType: 'date',
    },
  },
};
