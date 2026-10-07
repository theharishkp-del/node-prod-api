export const environment = {
  appVersion: '1.0.0',
  name: 'local',
  production: false,
  maps: {
    useNewPlacesAutocomplete: false,
  },
  api: {
    baseUrl: 'http://localhost:3002',
    endpoints: {
      lookupCybotUser: '/web/v1/onboarding/user-details',
      existingOnboarding: '/web/v1/onboarding/existing',
      completeRegistration: '/web/v1/onboarding/complete',
      zohoStatus: '/zoho/v1/status',
      zohoSelectOrganization: '/zoho/v1/select-organization',
      zohoAutoSync: '/zoho/v1/auto-sync',
      masterDataBase: '/web/v1/master-data',
    },
  },
};
