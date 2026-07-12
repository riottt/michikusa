import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const python = path.join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Python environment is missing. Run `npm run setup` once, then retry.");
  process.exit(1);
}
const nextBin = path.join(root, "node_modules", ".bin", isWindows ? "next.cmd" : "next");
if (!existsSync(nextBin)) {
  console.error("Node dependencies are missing. Run `npm install` first.");
  process.exit(1);
}

const children = [];
let shuttingDown = false;
function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: false });
  children.push(child);
  child.on("error", (error) => { console.error(error); shutdown(1); });
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${command} stopped (${signal ?? code}).`);
      shutdown(code ?? 1);
    }
  });
  return child;
}
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill("SIGKILL");
    process.exit(code);
  }, 900).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));

console.log("MICHIKUSA local services");
console.log("  Web   http://localhost:3000");
console.log("  Agent http://localhost:8081");
start(python, ["-m", "uvicorn", "michikusa_agent.server:app", "--app-dir", "agent_service", "--host", "127.0.0.1", "--port", "8081", "--reload", "--reload-dir", "agent_service"], { PYTHONUNBUFFERED: "1" });
start(nextBin, ["dev", "-p", "3000"], { AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8081" });
