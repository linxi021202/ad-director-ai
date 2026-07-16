export function assertServerOnly(moduleName: string) {
  if (typeof window !== "undefined") {
    throw new Error(`${moduleName} is server-only and cannot be imported by a Client Component.`);
  }
}
