import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false, ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function findPython() {
  const candidates = [process.env.PYTHON, isWindows ? "py" : "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await run(candidate, isWindows && candidate === "py" ? ["-3", "--version"] : ["--version"], { stdio: "ignore" });
      return { command: candidate, prefix: isWindows && candidate === "py" ? ["-3"] : [] };
    } catch {
      // Try the next executable.
    }
  }
  throw new Error("Python 3.11以上が見つかりません。Pythonをインストールしてから再実行してください。");
}

async function main() {
  if (!existsSync(path.join(root, ".env.local"))) {
    await copyFile(path.join(root, ".env.example"), path.join(root, ".env.local"));
    console.log("Created .env.local from .env.example (DEMO_MODE=true).");
  }

  if (!existsSync(venvPython)) {
    const python = await findPython();
    console.log("Creating Python virtual environment...");
    await run(python.command, [...python.prefix, "-m", "venv", ".venv"]);
  }

  console.log("Installing Google ADK agent dependencies...");
  await run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "agent_service/requirements.txt"]);
  await mkdir(path.join(root, "data"), { recursive: true });
  await run(process.execPath, ["scripts/migrate.mjs"]);
  console.log("\nSetup complete. Run: npm run dev");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
