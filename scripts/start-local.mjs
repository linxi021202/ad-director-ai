import { spawn } from "node:child_process";
import net from "node:net";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "127.0.0.1";
const origin = `http://localhost:${port}`;
const healthUrl = `${origin}/api/health`;
let child = null;
let stopping = false;

function print(message) {
  process.stdout.write(`[AdDirector AI] ${message}\n`);
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
  });
}

async function isAdDirectorHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1800) });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.status === "ok" && payload?.service === "ad-director-ai";
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  opener.unref();
}

async function waitForHealth(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAdDirectorHealthy()) return true;
    if (child?.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill(signal);
}

process.on("SIGINT", () => { stop("SIGINT"); setTimeout(() => process.exit(0), 250); });
process.on("SIGTERM", () => { stop("SIGTERM"); setTimeout(() => process.exit(0), 250); });

if (await canConnect()) {
  if (await isAdDirectorHealthy()) {
    print(`项目已在 ${origin} 运行，直接打开浏览器。`);
    openBrowser(origin);
    process.exit(0);
  }
  print(`端口 ${port} 已被其他服务占用。请关闭占用程序，或使用 PORT=3001 npm run local。`);
  process.exit(1);
}

print(`正在启动开发服务：${origin}`);
child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "-p", String(port)], {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: false
});

const ready = await waitForHealth();
if (!ready) {
  print("服务未能在 90 秒内就绪，请查看上方 Next.js 日志。");
  stop();
  process.exit(1);
}

print(`服务已就绪：${origin}`);
print("关闭此终端或按 Ctrl+C 可停止本地网站。");
openBrowser(origin);

const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 0)));
process.exit(exitCode);