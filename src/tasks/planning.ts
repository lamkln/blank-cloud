import { generateText } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentSettings } from "../settings/agent-settings.js";
import { createLanguageModelForRole } from "../providers/model-runtime.js";
import { runWithModelFallback } from "../providers/fallback.js";
import { shallowFileTree } from "./context.js";
import type { TaskPlan, TaskPlanStep } from "./types.js";

const planSchema = z.object({
  steps: z
    .array(
      z.object({
        title: z.string().min(1),
        filesHint: z.string().optional(),
      }),
    )
    .min(2)
    .max(8),
  summary: z.string().optional(),
});

export function shouldCreatePlan(prompt: string, _settings: AgentSettings): boolean {
  const words = prompt.trim().split(/\s+/).length;
  if (words > 80 || prompt.length > 400) return true;
  if (/\b(fabric mod|entire project|whole project|scaffold|multi.?file)\b/i.test(prompt)) {
    return true;
  }
  const extHits = (prompt.match(/\b[\w./-]+\.(java|gradle|kts|json|md|ts|tsx|py)\b/gi) || [])
    .length;
  return extHits >= 3;
}

export async function generateTaskPlan(
  taskId: string,
  prompt: string,
): Promise<TaskPlan> {
  const tree = shallowFileTree();
  const system = `You are a software project planner. Output ONLY valid JSON (no markdown).
Split the user's request into 3-8 small implementation steps. Each step should touch at most a few related files.
Do not include build/test as separate steps unless essential.`;

  const user = `User request:\n${prompt}\n\nWorkspace root listing:\n${tree}\n\nJSON shape: {"steps":[{"title":"...","filesHint":"optional paths"}],"summary":"one line"}`;

  const text = await runWithModelFallback(taskId, "planning", async (model) => {
    const result = await generateText({
      model,
      system,
      prompt: user,
      maxTokens: 1200,
    });
    return result.text;
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = planSchema.parse(JSON.parse(jsonMatch?.[0] ?? text));

  const steps: TaskPlanStep[] = parsed.steps.map((s) => ({
    id: randomUUID(),
    title: s.title.trim(),
    filesHint: s.filesHint?.trim() || "",
    status: "pending",
  }));

  return {
    steps,
    currentStepIndex: 0,
    compactSummary: parsed.summary?.trim() || prompt.slice(0, 240),
  };
}
