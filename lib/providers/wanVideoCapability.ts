export type WanVideoCapability = "api-available" | "manual-import" | "not-configured";

export type WanVideoCapabilityState = {
  provider: "wan";
  capability: WanVideoCapability;
  apiAvailable: boolean;
  manualImportAvailable: boolean;
  status: "ready" | "blocked" | "waiting-manual-import";
};

export function getWanVideoCapability(manualImportAvailable = true, apiAvailable = false): WanVideoCapabilityState {
  if (apiAvailable) {
    return {
      provider: "wan",
      capability: "api-available",
      apiAvailable: true,
      manualImportAvailable,
      status: "ready"
    };
  }

  return manualImportAvailable
    ? {
        provider: "wan",
        capability: "manual-import",
        apiAvailable: false,
        manualImportAvailable: true,
        status: "waiting-manual-import"
      }
    : {
        provider: "wan",
        capability: "not-configured",
        apiAvailable: false,
        manualImportAvailable: false,
        status: "blocked"
      };
}
