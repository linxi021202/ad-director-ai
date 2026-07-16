export type HappyHorseCapability = "api-available" | "manual-import" | "not-configured";

export type HappyHorseCapabilityState = {
  provider: "happyhorse";
  capability: HappyHorseCapability;
  apiAvailable: boolean;
  manualImportAvailable: boolean;
  status: "ready" | "blocked" | "waiting-manual-import";
};

export function getHappyHorseCapability(manualImportAvailable = true, apiAvailable = false): HappyHorseCapabilityState {
  if (apiAvailable) {
    return {
      provider: "happyhorse",
      capability: "api-available",
      apiAvailable: true,
      manualImportAvailable,
      status: "ready"
    };
  }

  return manualImportAvailable
    ? {
        provider: "happyhorse",
        capability: "manual-import",
        apiAvailable: false,
        manualImportAvailable: true,
        status: "waiting-manual-import"
      }
    : {
        provider: "happyhorse",
        capability: "not-configured",
        apiAvailable: false,
        manualImportAvailable: false,
        status: "blocked"
      };
}
