import { tool } from "ai";
import { z } from "zod";
import { modScaffold } from "../mod/scaffold.js";
import { runModBuild, markModBuildFailOnce } from "../mod/build.js";
import { validateModJar } from "../mod/validate.js";
import { packageForModrinth } from "../mod/modrinth-package.js";
import { registerArtifact } from "./artifacts.js";
import { emit } from "./store.js";
import { readWorkspaceFile } from "../workspace/paths.js";

function displayPath(rel: string): string {
  const p = rel.trim() || ".";
  if (p === "." || p === "./") return "project root";
  return p;
}

export function buildModMakerTools(taskId: string) {
  return {
    mod_scaffold: tool({
      description:
        "Scaffold a Minecraft mod project (fabric|neoforge|paper). Resolves real versions from Fabric meta / Maven at scaffold time.",
      parameters: z.object({
        loader: z.enum(["fabric", "neoforge", "paper"]),
        minecraft_version: z.string().optional(),
        mod_id: z.string(),
        mod_name: z.string(),
        project_path: z.string().optional(),
      }),
      execute: async (args) => {
        emit(taskId, "tool", `Scaffold ${args.loader} mod ${args.mod_id}`, {
          tool: "mod_scaffold",
          loader: args.loader,
          modId: args.mod_id,
        });
        emit(taskId, "status", "Mod Maker: scaffolding project…", {
          phase: "scaffold",
          mode: "mod-maker",
        });
        try {
          const result = await modScaffold({
            loader: args.loader,
            minecraftVersion: args.minecraft_version,
            modId: args.mod_id,
            modName: args.mod_name,
            projectPath: args.project_path,
          });
          return result;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    mod_build: tool({
      description: "Run ./gradlew build --no-daemon in a mod project directory",
      parameters: z.object({
        project_path: z.string().describe("Relative path to mod project root"),
      }),
      execute: async ({ project_path }) => {
        emit(taskId, "tool", `Build mod at ${displayPath(project_path)}`, {
          tool: "mod_build",
          path: project_path,
        });
        emit(taskId, "status", "Mod Maker: building…", { phase: "build", mode: "mod-maker" });
        if (process.env.BLANK_CLOUD_TEST_MOD_BUILD_FAIL_ONCE === "1") {
          markModBuildFailOnce(taskId);
        }
        const result = await runModBuild(taskId, project_path);
        for (const a of result.artifacts) {
          registerArtifact(taskId, a.path);
        }
        return result;
      },
    }),

    mod_validate: tool({
      description: "Validate built mod jar (fabric.mod.json, id, license, icon). Optional Fabric server smoke boot.",
      parameters: z.object({
        jar_path: z.string(),
        smoke_server: z.boolean().optional().default(false),
        minecraft_version: z.string().optional(),
        loader_version: z.string().optional(),
      }),
      execute: async (args) => {
        emit(taskId, "tool", `Validate ${displayPath(args.jar_path)}`, {
          tool: "mod_validate",
          path: args.jar_path,
        });
        emit(taskId, "status", "Mod Maker: validating jar…", {
          phase: "validate",
          mode: "mod-maker",
        });
        const result = await validateModJar(args.jar_path, {
          smokeServer: args.smoke_server,
          minecraftVersion: args.minecraft_version,
          loaderVersion: args.loader_version,
        });
        return result;
      },
    }),

    modrinth_package: tool({
      description: "Create modrinth/metadata.json and a downloadable zip for Modrinth handoff (no API upload).",
      parameters: z.object({
        project_path: z.string(),
        jar_path: z.string(),
        mod_id: z.string(),
        name: z.string(),
        summary: z.string(),
        version: z.string(),
        license: z.string().default("MIT"),
        minecraft_versions: z.array(z.string()),
        loaders: z.array(z.string()).default(["fabric"]),
        changelog: z.string().optional(),
      }),
      execute: async (args) => {
        emit(taskId, "tool", `Package for Modrinth: ${args.mod_id}`, {
          tool: "modrinth_package",
          modId: args.mod_id,
        });
        emit(taskId, "status", "Mod Maker: packaging for Modrinth…", {
          phase: "package",
          mode: "mod-maker",
        });
        try {
          const pkg = packageForModrinth({
            modId: args.mod_id,
            name: args.name,
            summary: args.summary,
            version: args.version,
            changelog: args.changelog,
            license: args.license,
            minecraftVersions: args.minecraft_versions,
            loaders: args.loaders,
            clientSide: "required",
            serverSide: "required",
            jarRel: args.jar_path,
            projectPath: args.project_path,
          });
          registerArtifact(taskId, pkg.zipPath);
          registerArtifact(taskId, args.jar_path);
          return pkg;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}

export function readGradleProperty(projectPath: string, key: string): string | null {
  try {
    const content = readWorkspaceFile(`${projectPath}/gradle.properties`);
    const m = content.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
