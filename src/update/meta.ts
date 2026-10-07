import fs from "node:fs";
import path from "node:path";
import { BUILD_INFO } from "../build-info.generated.js";

export const UPSTREAM_REPO = "lamkln/blank-cloud";
export const DEFAULT_UPDATE_REF = "main";

export function getInstallDir(): string | null {
  const dir = process.env.BLANK_CLOUD_INSTALL_DIR?.trim();
  if (!dir) return null;
  try {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function readLocalCommit(): string {
  const fromEnv = process.env.BLANK_CLOUD_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  if (BUILD_INFO.commit && String(BUILD_INFO.commit) !== "unknown") {
    return String(BUILD_INFO.commit);
  }
  const install = getInstallDir();
  if (install) {
    const head = path.join(install, ".git", "HEAD");
    if (fs.existsSync(head)) {
      const ref = fs.readFileSync(head, "utf8").trim();
      if (ref.startsWith("ref: ")) {
        const refPath = path.join(install, ".git", ref.slice(5));
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, "utf8").trim();
        }
      }
      if (/^[a-f0-9]{40}$/i.test(ref)) {
        return ref;
      }
    }
  }
  return BUILD_INFO.commit || "unknown";
}

export function getApplyBlockers(): string[] {
  const blockers: string[] = [];
  const install = getInstallDir();
  if (!install) {
    blockers.push("Set BLANK_CLOUD_INSTALL_DIR to your host clone (e.g. /install with .:/install mounted)");
    return blockers;
  }
  if (!fs.existsSync(path.join(install, "docker-compose.yml"))) {
    blockers.push("Install directory is missing docker-compose.yml");
  }
  if (!fs.existsSync(path.join(install, "scripts", "update.sh"))) {
    blockers.push("Install directory is missing scripts/update.sh");
  }
  if (!fs.existsSync("/var/run/docker.sock")) {
    blockers.push("Mount /var/run/docker.sock for Docker rebuild/restart");
  }
  const flag = process.env.BLANK_CLOUD_UPDATE_APPLY?.trim();
  const implicitInstall =
    path.resolve(install) === "/install" &&
    blockers.length === 0;
  if (flag === "0") {
    blockers.push("BLANK_CLOUD_UPDATE_APPLY=0 disables one-click apply");
  } else if (flag !== "1" && !implicitInstall) {
    blockers.push(
      "Set BLANK_CLOUD_UPDATE_APPLY=1 (or use docker-compose.override.yml from the repo)",
    );
  }
  return blockers;
}

export function canApplyUpdates(): boolean {
  return getApplyBlockers().length === 0;
}

export function normalizeSha(sha: string | null | undefined): string {
  return (sha ?? "").trim().toLowerCase();
}

export function commitsMatch(a: string, b: string): boolean {
  const x = normalizeSha(a);
  const y = normalizeSha(b);
  if (!x || !y || x === "unknown" || y === "unknown") return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}
