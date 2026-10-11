import {
  pickLatestMinecraftPatch,
  resolveFabricVersions,
} from "./fabric-meta.js";
import { scaffoldFabricRubyMod } from "./scaffold-fabric.js";

export type ModLoader = "fabric" | "neoforge" | "paper";

export interface ModScaffoldRequest {
  loader: ModLoader;
  minecraftVersion?: string;
  modId: string;
  modName: string;
  projectPath?: string;
}

export async function modScaffold(req: ModScaffoldRequest) {
  const modId = req.modId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(modId)) {
    throw new Error("modId must be lowercase letters, digits, underscores; start with a letter");
  }
  const projectPath = (req.projectPath ?? `minecraft-mods/${modId}`).replace(/^\/+/, "");

  if (req.loader === "fabric") {
    let mc = req.minecraftVersion?.trim();
    if (!mc) {
      mc = await pickLatestMinecraftPatch("1.21.");
    }
    const versions = await resolveFabricVersions(mc);
    const result = await scaffoldFabricRubyMod({
      modId,
      modName: req.modName,
      projectPath,
      versions,
    });
    return {
      loader: "fabric",
      projectPath: result.projectPath,
      minecraft: versions.minecraft,
      fabricLoader: versions.loader,
      loaderVersion: versions.loader,
      yarn: versions.yarn,
      fabricApi: result.fabricApi,
      filesWritten: result.files.length,
    };
  }

  if (req.loader === "neoforge" || req.loader === "paper") {
    throw new Error(`${req.loader} scaffold is not implemented yet — use fabric for ruby template`);
  }

  throw new Error(`Unknown loader: ${req.loader}`);
}
