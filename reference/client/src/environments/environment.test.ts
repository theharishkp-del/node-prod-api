export const environment = {
  appVersion: '2.0.0',
  name: 'test',
  production: true,
  maps: {
    useNewPlacesAutocomplete: false,
  },
  api: {
        // baseUrl: 'https://cybotfsm.cybot.world',
      baseUrl: 'https://devmh.cognitivemobile.net/agent',
    // baseUrl: 'https://devvir.cognitivemobile.net/agent',
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
