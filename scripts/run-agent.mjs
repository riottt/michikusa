import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const python = path.join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error(".venv is missing. Run `npm run setup` first.");
  process.exit(1);
}
const reload = process.argv.includes("--reload");
const port = process.env.AGENT_PORT || process.env.PORT || "8081";
const args = ["-m", "uvicorn", "michikusa_agent.server:app", "--app-dir", "agent_service", "--host", "0.0.0.0", "--port", port];
if (reload) args.push("--reload", "--reload-dir", "agent_service");
const child = spawn(python, args, { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONUNBUFFERED: "1" } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exitCode = signal ? 0 : (code ?? 1));
