export function getProjectAssetUrl(projectId: string, assetId: string, options?: { download?: boolean }): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
  return options?.download ? `${base}?download=1` : base;
}
