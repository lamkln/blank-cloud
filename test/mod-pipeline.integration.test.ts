import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { modScaffold } from "../dist/mod/scaffold.js";
import { runModBuild } from "../dist/mod/build.js";
import { validateModJar } from "../dist/mod/validate.js";
import { packageForModrinth } from "../dist/mod/modrinth-package.js";

const ROOT = path.join(process.cwd(), "project-integration-mod");

describe("mod maker pipeline (integration)", () => {
  beforeAll(() => {
    process.env.WORKSPACE = ROOT;
    process.env.BLANK_CLOUD_DATA = path.join(process.cwd(), "data-integration-mod");
    fs.mkdirSync(ROOT, { recursive: true });
  });

  it(
    "scaffold → build → validate → package produces a jar and zip",
    async () => {
      const projectPath = "ruby_mod_integration";
      const scaffold = await modScaffold({
        loader: "fabric",
        minecraftVersion: "1.21.1",
        modId: "ruby_mod",
        modName: "Ruby Mod",
        projectPath,
      });
      expect(scaffold.minecraft).toMatch(/^1\.21\./);

      const build = await runModBuild("integration-task", projectPath);
      expect(build.success).toBe(true);
      expect(build.artifacts.length).toBeGreaterThan(0);

      const jarRel = build.artifacts[0].path;
      const validation = await validateModJar(jarRel, {
        smokeServer: true,
        minecraftVersion: scaffold.minecraft,
        loaderVersion: scaffold.fabricLoader,
      });
      expect(validation.valid).toBe(true);
      expect(validation.smokeServer?.ok).toBe(true);
      expect(validation.smokeServer?.logExcerpt).toMatch(/Ruby Mod loaded/);
      expect(validation.smokeServer?.logExcerpt).toMatch(/Done \(/);

      const pkg = packageForModrinth({
        modId: "ruby_mod",
        name: "Ruby Mod",
        summary: "Ruby ore, gem, sword",
        version: "1.0.0",
        license: "MIT",
        minecraftVersions: [scaffold.minecraft],
        loaders: ["fabric"],
        clientSide: "required",
        serverSide: "required",
        jarRel,
        projectPath,
      });
      expect(fs.existsSync(path.join(ROOT, pkg.zipPath))).toBe(true);
    },
    600_000,
  );
});
