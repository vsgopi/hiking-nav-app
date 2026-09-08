export const env = {
  appName: 'Hiking Nav',
  /**
   * Dev/staging-only override for the repository's license gate (see
   * domain/repositories/licenseGate.ts): when true, Trust-sourced fields with
   * redistribution_status 'pending'/'not_allowed' are served anyway, for
   * engineering use. `__DEV__` is React Native's own dev-vs-release-build
   * global — false in every production build — so this can never be
   * accidentally true in a shipped app regardless of runtime data/config.
   */
  allowUnconfirmedSources: __DEV__,
} as const;
