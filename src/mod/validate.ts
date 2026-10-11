import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveWorkspacePath } from "../workspace/paths.js";
import { getWorkspaceRoot } from "../config.js";
import { resolveFabricApiVersion } from "./fabric-meta.js";

const MOD_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;

import { execFileSync } from "node:child_process";

function readJarEntrySync(jarAbs: string, entryPath: string): string | null {
  try {
    const buf = execFileSync("unzip", ["-p", jarAbs, entryPath], {
      encoding: "buffer",
      maxBuffer: 2_000_000,
    });
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export interface ModValidateResult {
  valid: boolean;
  modId: string | null;
  issues: string[];
  fabricModJson: Record<string, unknown> | null;
  smokeServer?: { ok: boolean; logExcerpt: string };
}

export async function validateModJar(
  jarRel: string,
  options: { smokeServer?: boolean; minecraftVersion?: string; loaderVersion?: string } = {},
): Promise<ModValidateResult> {
  const issues: string[] = [];
  const jarAbs = resolveWorkspacePath(jarRel);
  if (!fs.existsSync(jarAbs)) {
    return { valid: false, modId: null, issues: [`Jar not found: ${jarRel}`], fabricModJson: null };
  }

  const fabricRaw = readJarEntrySync(jarAbs, "fabric.mod.json");
  let fabricModJson: Record<string, unknown> | null = null;
  let modId: string | null = null;
  if (!fabricRaw) {
    issues.push("Missing fabric.mod.json in jar");
  } else {
    try {
      fabricModJson = JSON.parse(fabricRaw) as Record<string, unknown>;
      modId = String(fabricModJson.id ?? "");
      if (!MOD_ID_RE.test(modId)) {
        issues.push(`Invalid mod id format: ${modId}`);
      }
      if (!fabricModJson.license) {
        issues.push("Missing license in fabric.mod.json");
      }
      if (!fabricModJson.depends) {
        issues.push("Missing depends in fabric.mod.json");
      }
      const icon = fabricModJson.icon;
      if (!icon) {
        issues.push("Missing icon in fabric.mod.json");
      } else if (typeof icon === "string") {
        const iconData = readJarEntrySync(jarAbs, icon.startsWith("assets/") ? icon : `assets/${modId}/${icon}`);
        if (!iconData && !readJarEntrySync(jarAbs, `assets/${modId}/icon.png`)) {
          issues.push("Icon file not found in jar");
        }
      }
    } catch {
      issues.push("fabric.mod.json is not valid JSON");
    }
  }

  let smokeServer: ModValidateResult["smokeServer"];
  if (options.smokeServer && modId) {
    smokeServer = await runFabricSmokeServer(jarAbs, options.minecraftVersion, options.loaderVersion);
    if (!smokeServer.ok) {
      issues.push("Fabric dedicated server smoke boot failed");
    }
  }

  return {
    valid: issues.length === 0,
    modId,
    issues,
    fabricModJson,
    smokeServer,
  };
}

async function runFabricSmokeServer(
  jarAbs: string,
  minecraftVersion?: string,
  loaderVersion?: string,
): Promise<{ ok: boolean; logExcerpt: string }> {
  const mc = minecraftVersion ?? "1.21.1";
  const loader = loaderVersion ?? "0.16.9";
  const smokeDir = path.join(getWorkspaceRoot(), ".blank-cloud-smoke");
  fs.mkdirSync(smokeDir, { recursive: true });
  const modsDir = path.join(smokeDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });
  fs.copyFileSync(jarAbs, path.join(modsDir, path.basename(jarAbs)));
  const fabricApiVer = await resolveFabricApiVersion(mc);
  const apiUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${fabricApiVer}/fabric-api-${fabricApiVer}.jar`;
  const apiJar = path.join(modsDir, `fabric-api-${fabricApiVer}.jar`);
  if (!fs.existsSync(apiJar)) {
    const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(120_000) });
    if (!apiRes.ok) {
      return { ok: false, logExcerpt: `Could not download fabric-api: HTTP ${apiRes.status}` };
    }
    fs.writeFileSync(apiJar, Buffer.from(await apiRes.arrayBuffer()));
  }
  fs.writeFileSync(path.join(smokeDir, "eula.txt"), "eula=true\n");
  fs.writeFileSync(
    path.join(smokeDir, "server.properties"),
    `level-seed=12345
gamemode=creative
force-gamemode=true
online-mode=false
`,
  );

  const serverJar = path.join(smokeDir, "server.jar");
  if (!fs.existsSync(serverJar)) {
    const metaUrl = `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/1.0.0/server/jar`;
    const res = await fetch(metaUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      return { ok: false, logExcerpt: `Could not download Fabric server jar: HTTP ${res.status}` };
    }
    fs.writeFileSync(serverJar, Buffer.from(await res.arrayBuffer()));
  }

  return new Promise((resolve) => {
    const log: string[] = [];
    const child = spawn(
      "java",
      ["-Xmx1024M", "-jar", serverJar, "nogui"],
      { cwd: smokeDir, env: { ...process.env } },
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        ok: false,
        logExcerpt: log.join("\n").slice(-3000) + "\n(timeout waiting for Done)",
      });
    }, 180_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      log.push(text);
      if (text.includes("Done (") && !log.join("").includes("__BLANK_CLOUD_SMOKE_CMDS")) {
        log.push("__BLANK_CLOUD_SMOKE_CMDS");
        child.stdin?.write("summon minecraft:pig 0 80 0 {Silent:1b,NoAI:1b}\n");
        child.stdin?.write("give @e[type=minecraft:pig,limit=1] ruby_mod:ruby_sword 1\n");
        child.stdin?.write("execute at @e[type=minecraft:pig,limit=1] run place feature ruby_mod:ruby_ore_placed\n");
        setTimeout(() => {
          clearTimeout(timer);
          child.kill("SIGTERM");
          resolve({ ok: true, logExcerpt: log.join("").slice(-4000) });
        }, 8000);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", () => {
      clearTimeout(timer);
      const joined = log.join("");
      resolve({
        ok: joined.includes("Done ("),
        logExcerpt: joined.slice(-3000),
      });
    });
  });
}
