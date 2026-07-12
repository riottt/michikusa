import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
const root = process.cwd();
const isWindows = process.platform === "win32";
const python = path.join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Run `npm run setup` before tests.");
  process.exit(1);
}
const child = spawn(python, ["-m", "pytest", "agent_service/tests", "-q"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONPATH: path.join(root, "agent_service"), DEMO_MODE: "true" }
});
child.on("exit", (code) => process.exit(code ?? 1));
