import { z } from "zod";

export interface FileChangeInput {
  path: string;
  content: string;
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1].trim() : t;
}

export function parseJsonLenient(text: string): unknown {
  const cleaned = stripCodeFences(text).replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(cleaned);
}

function coerceFileEntry(raw: unknown): FileChangeInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path.trim() : "";
  let content = o.content;
  if (content === undefined && typeof o.text === "string") {
    content = o.text;
  }
  if (typeof content === "object" && content !== null) {
    content = JSON.stringify(content, null, 2);
  }
  if (!path || typeof content !== "string") return null;
  return { path, content };
}

/**
 * Normalize model tool args where `files` is a string, a single JSON blob, or a
 * wrongly-split array of string fragments (never split strings ourselves).
 */
export function normalizeFilesField(value: unknown): FileChangeInput[] {
  if (value === undefined || value === null) {
    throw new Error("files is required");
  }

  let working: unknown = value;

  if (typeof working === "string") {
    working = parseJsonLenient(working);
  }

  if (Array.isArray(working) && working.length === 1 && typeof working[0] === "string") {
    const sole = working[0].trim();
    if (sole.startsWith("[") || sole.startsWith("{")) {
      try {
        working = parseJsonLenient(sole);
      } catch {
        /* keep array */
      }
    }
  }

  if (Array.isArray(working) && working.length > 1 && working.every((x) => typeof x === "string")) {
    const joined = working.join("");
    if (joined.trim().startsWith("[")) {
      try {
        working = parseJsonLenient(joined);
      } catch {
        const alt = (working as string[]).join(",");
        try {
          working = parseJsonLenient(`[${alt}]`);
        } catch {
          /* fall through */
        }
      }
    }
  }

  if (!Array.isArray(working)) {
    const one = coerceFileEntry(working);
    if (one) return [one];
    throw new Error(
      "files must be an array of {path, content} objects, not a string or single object",
    );
  }

  const out: FileChangeInput[] = [];
  for (const item of working) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.startsWith("{")) {
        const parsed = coerceFileEntry(parseJsonLenient(trimmed));
        if (parsed) {
          out.push(parsed);
          continue;
        }
      }
      throw new Error(
        "files must be an array of {path, content} objects — got a string element (do not stringify the array)",
      );
    }
    const entry = coerceFileEntry(item);
    if (!entry) {
      throw new Error("each files[] entry needs path and content strings");
    }
    out.push(entry);
  }

  if (out.length === 0) {
    throw new Error("files array is empty");
  }
  return out;
}

export function normalizeCommandsField(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      const parsed = parseJsonLenient(t);
      if (Array.isArray(parsed)) {
        return parsed.map((c) => String(c));
      }
    }
    return [t];
  }
  if (Array.isArray(value)) {
    return value.map((c) => String(c));
  }
  return [];
}

export const proposeChangesArgsSchema = z.object({
  summary: z.string(),
  files: z.preprocess(
    (v) => normalizeFilesField(v),
    z.array(z.object({ path: z.string(), content: z.string() })).min(1),
  ),
  commands: z
    .preprocess((v) => normalizeCommandsField(v), z.array(z.string()))
    .optional()
    .default([]),
});

export function formatProposeChangesValidationError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `propose_changes argument error: ${msg}. Pass files as a JSON array of objects like [{"path":"src/Main.java","content":"..."}] — never as a stringified array.`;
}
