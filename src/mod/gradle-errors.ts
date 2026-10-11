export interface CompileError {
  file: string;
  line: number;
  column?: number;
  message: string;
}

/** Parse javac / Gradle Java compile failure lines */
export function parseGradleCompileErrors(output: string): CompileError[] {
  const errors: CompileError[] = [];
  const lines = output.split(/\r?\n/);
  const re = /^(\/[^\s:]+\.java):(\d+):(?: error:)?\s*(.+)$/;
  const reRel = /^([A-Za-z0-9_./-]+\.java):(\d+):\s*(?:error:\s*)?(.+)$/;
  for (const line of lines) {
    let m = line.match(re);
    if (!m) m = line.match(reRel);
    if (m) {
      errors.push({
        file: m[1].replace(/^\/workspace\//, "").replace(/^\.\//, ""),
        line: Number(m[2]),
        message: m[3].trim(),
      });
    }
  }
  return errors;
}

export function findBuiltJars(projectRel: string, stdout: string): string[] {
  const jars: string[] = [];
  const root = projectRel.replace(/\/$/, "");
  const re = new RegExp(`${root}/build/libs/[^\\s'"]+\\.jar`, "g");
  for (const m of stdout.matchAll(re)) {
    jars.push(m[0]);
  }
  return [...new Set(jars)];
}
