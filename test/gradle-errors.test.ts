import { describe, expect, it } from "vitest";
import { parseGradleCompileErrors } from "../src/mod/gradle-errors.js";

describe("parseGradleCompileErrors", () => {
  it("parses javac style errors", () => {
    const log = `
> Task :compileJava FAILED
/path/to/src/main/java/Foo.java:12: error: cannot find symbol
  symbol:   class Bar
`;
    const errs = parseGradleCompileErrors(log);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].line).toBe(12);
    expect(errs[0].message).toContain("cannot find symbol");
  });
});
