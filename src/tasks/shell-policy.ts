/** Basic guardrails for agent-run shell (workspace cwd only; not a full sandbox). */

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\*/,
  /\bmkfs\./,
  /\bdd\s+if=/,
  /\b>\s*\/dev\/sd/,
  /:\(\)\s*\{\s*:\|\:&\s*\};:/,
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,
  /\bwget\s+.*\|\s*(ba)?sh\b/i,
];

export function assertShellCommandAllowed(command: string): void {
  const c = command.trim();
  if (!c) {
    throw new Error("Empty shell command");
  }
  if (c.length > 4000) {
    throw new Error("Shell command too long");
  }
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(c)) {
      throw new Error("This shell command is blocked for safety");
    }
  }
}

export function agentShellEnabled(): boolean {
  const raw = process.env.BLANK_CLOUD_AGENT_SHELL?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") {
    return false;
  }
  return true;
}
