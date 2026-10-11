import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace/paths.js";

const GRADLE_VERSION = "8.12";

const GRADLEW = `#!/bin/sh
#
# Gradle start script (minimal) — full wrapper installed by mod_scaffold
#
set -e
APP_HOME=\`cd "\${0%/*}" && pwd -P\`
CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar
exec java -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`;

export async function installGradleWrapper(projectRel: string): Promise<void> {
  const root = resolveWorkspacePath(projectRel);
  const wrapperDir = path.join(root, "gradle", "wrapper");
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(root, "gradlew"), GRADLEW, { mode: 0o755 });
  fs.writeFileSync(
    path.join(wrapperDir, "gradle-wrapper.properties"),
    `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
  );
  const jarUrl = `https://github.com/gradle/gradle/raw/v${GRADLE_VERSION}.0/gradle/wrapper/gradle-wrapper.jar`;
  const res = await fetch(jarUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`Could not download gradle-wrapper.jar (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(wrapperDir, "gradle-wrapper.jar"), buf);
}
