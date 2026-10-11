import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const PROJECT = path.join(process.cwd(), "project-api-test");
const DATA = path.join(process.cwd(), "data-api-test");
const PORT = 8798;

async function waitForHealth(ms = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("health timeout");
}

describe("tasks API", () => {
  let proc: ChildProcess;

  beforeAll(async () => {
    fs.mkdirSync(PROJECT, { recursive: true });
    fs.mkdirSync(DATA, { recursive: true });
    proc = spawn("node", ["dist/server.js"], {
      env: {
        ...process.env,
        PORT: String(PORT),
        WORKSPACE: PROJECT,
        BLANK_CLOUD_DATA: DATA,
        BLANK_CLOUD_TEST_MODE: "1",
        LLM_PROVIDER: "custom",
        CUSTOM_OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
        CUSTOM_OPENAI_API_KEY: "x",
        LLM_MODEL: "mock",
      },
      stdio: "ignore",
    });
    await waitForHealth();
  }, 30_000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("accepts mode mod-maker on POST /tasks", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "mod-maker",
        prompt: "Make a Fabric mod",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { mode: string; id: string };
    expect(body.mode).toBe("mod-maker");
    expect(body.id).toBeTruthy();
  });
});
