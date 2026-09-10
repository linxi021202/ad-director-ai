export function getInternalRenderOrigin(env: { PORT?: string } = process.env as { PORT?: string }) {
  const parsed = Number.parseInt(env.PORT || "3000", 10);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 3000;
  return `http://127.0.0.1:${port}`;
}
