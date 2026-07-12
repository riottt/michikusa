import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { HarnessError } from "./contracts.mjs";
import { compileSchemas, loadHarnessConfig } from "./schema.mjs";

async function readRequired(repoRoot, relativePath) {
  try {
    return await readFile(path.join(repoRoot, relativePath), "utf8");
  } catch {
    throw new HarnessError(`Required harness file is missing: ${relativePath}`, {
      nextActions: [`Restore ${relativePath}.`],
      artifacts: [relativePath],
    });
  }
}

function parseRequiredToml(contents, relativePath) {
  try {
    return parseToml(contents);
  } catch (error) {
    throw new HarnessError(`Invalid TOML in ${relativePath}: ${error.message}`, {
      nextActions: [`Repair TOML syntax in ${relativePath}.`],
      artifacts: [relativePath],
    });
  }
}

export async function checkHarnessInstallation(repoRoot) {
  const config = await loadHarnessConfig(repoRoot);
  await compileSchemas(repoRoot, config);

  const codexConfig = await readRequired(repoRoot, ".codex/config.toml");
  const parsedConfig = parseRequiredToml(codexConfig, ".codex/config.toml");
  const validConfig = codexConfig.startsWith("#:schema https://developers.openai.com/codex/config-schema.json")
    && parsedConfig.features?.multi_agent === true
    && parsedConfig.agents?.max_threads === 4
    && parsedConfig.agents?.max_depth === 1
    && parsedConfig.agents?.planner?.config_file === "agents/planner.toml"
    && parsedConfig.agents?.implementer?.config_file === "agents/implementer.toml"
    && parsedConfig.agents?.reviewer?.config_file === "agents/reviewer.toml";
  if (!validConfig) {
    throw new HarnessError("Codex multi-agent config has drifted from the harness contract.", {
      nextActions: ["Restore the schema header, agent limits, and three role mappings in .codex/config.toml."],
      artifacts: [".codex/config.toml"],
    });
  }

  for (const role of ["planner", "implementer", "reviewer"]) {
    const relativePath = `.codex/agents/${role}.toml`;
    const contents = await readRequired(repoRoot, relativePath);
    const parsedRole = parseRequiredToml(contents, relativePath);
    const expectedSchema = `schemas/${role === "planner" ? "plan" : role === "implementer" ? "implementation" : "review"}.schema.json`;
    if (parsedRole.name !== role
      || typeof parsedRole.description !== "string"
      || !["read-only", "workspace-write"].includes(parsedRole.sandbox_mode)
      || typeof parsedRole.developer_instructions !== "string"
      || !parsedRole.developer_instructions.includes(expectedSchema)
      || !parsedRole.developer_instructions.includes("actor_id")
      || !parsedRole.developer_instructions.includes("task_slug")
      || !parsedRole.developer_instructions.includes("iteration")) {
      throw new HarnessError(`Agent role config has drifted: ${role}.`, {
        nextActions: [`Restore provenance and schema instructions in ${relativePath}.`],
        artifacts: [relativePath],
      });
    }
  }

  const skillPath = ".codex/skills/team-delivery-excellence/SKILL.md";
  const skill = await readRequired(repoRoot, skillPath);
  if (["planner", "implementer", "reviewer", "../../../docs/HARNESS.md"].some((fragment) => !skill.includes(fragment))
    || skill.includes("/Users/")
    || /tdd-guide|code-reviewer|security-reviewer|e2e-runner/.test(skill)) {
    throw new HarnessError("Repo-local delivery skill is not portable or references undefined roles.", {
      nextActions: [`Restore the three-role portable workflow in ${skillPath}.`],
      artifacts: [skillPath],
    });
  }
  return config;
}
