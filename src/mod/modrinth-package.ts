import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveWorkspacePath, writeWorkspaceFile } from "../workspace/paths.js";

export interface ModrinthPackageInput {
  modId: string;
  name: string;
  summary: string;
  body?: string;
  version: string;
  changelog?: string;
  license: string;
  minecraftVersions: string[];
  loaders: string[];
  categories?: string[];
  clientSide: "required" | "optional" | "unsupported";
  serverSide: "required" | "optional" | "unsupported";
  jarRel: string;
  projectPath: string;
}

export interface ModrinthPackageResult {
  zipPath: string;
  metadataPath: string;
  sha256: string;
}

export function packageForModrinth(input: ModrinthPackageInput): ModrinthPackageResult {
  const base = input.projectPath.replace(/\/$/, "");
  const modrinthDir = `${base}/modrinth`;
  const metadata = {
    name: input.name,
    slug: input.modId,
    summary: input.summary,
    body: input.body ?? input.summary,
    categories: input.categories ?? ["adventure", "equipment"],
    loaders: input.loaders,
    game_versions: input.minecraftVersions,
    version_number: input.version,
    changelog: input.changelog ?? "Initial release",
    license: input.license,
    client_side: input.clientSide,
    server_side: input.serverSide,
  };
  const metadataPath = `${modrinthDir}/metadata.json`;
  writeWorkspaceFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const projectAbs = resolveWorkspacePath(base);
  const jarAbs = resolveWorkspacePath(input.jarRel);
  const staging = resolveWorkspacePath(`${modrinthDir}/staging`);
  fs.mkdirSync(staging, { recursive: true });
  fs.copyFileSync(jarAbs, path.join(staging, path.basename(jarAbs)));
  fs.copyFileSync(resolveWorkspacePath(metadataPath), path.join(staging, "metadata.json"));
  const iconInProject = path.join(
    projectAbs,
    "src/main/resources/assets",
    input.modId,
    "icon.png",
  );
  if (fs.existsSync(iconInProject)) {
    fs.copyFileSync(iconInProject, path.join(staging, "icon.png"));
  }

  const zipPath = `${modrinthDir}/${input.modId}-${input.version}-modrinth.zip`;
  const zipAbs = resolveWorkspacePath(zipPath);
  if (fs.existsSync(zipAbs)) fs.unlinkSync(zipAbs);
  execFileSync(
    "zip",
    ["-r", zipAbs, "."],
    { cwd: staging },
  );

  const hash = createHash("sha256");
  hash.update(fs.readFileSync(zipAbs));
  return {
    zipPath,
    metadataPath,
    sha256: hash.digest("hex"),
  };
}
