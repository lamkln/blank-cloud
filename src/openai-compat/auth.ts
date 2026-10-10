export function getOpenAiCompatApiKey(): string {
  return (
    process.env.BLANK_CLOUD_API_KEY?.trim() ||
    process.env.BLANK_CLOUD_OPENAI_API_KEY?.trim() ||
    ""
  );
}

export function isOpenAiCompatEnabled(): boolean {
  return Boolean(getOpenAiCompatApiKey());
}

export function assertOpenAiCompatAuth(authHeader: string | undefined): boolean {
  const expected = getOpenAiCompatApiKey();
  if (!expected) return false;
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return m[1].trim() === expected;
}
