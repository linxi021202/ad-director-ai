import path from "node:path";

type RemotionBundler = typeof import("@remotion/bundler");
let cachedBundle: Promise<string> | null = null;
const externalImport = new Function("moduleName", "return import(moduleName)") as <T>(moduleName: string) => Promise<T>;

export function getRemotionBundle() {
  if (!cachedBundle) {
    cachedBundle = externalImport<RemotionBundler>("@remotion/bundler").then(({ bundle }) => bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
      publicDir: path.join(process.cwd(), "public")
    }));
    cachedBundle.catch(() => { cachedBundle = null; });
  }
  return cachedBundle;
}

export function resetRemotionBundleForTests() {
  cachedBundle = null;
}

