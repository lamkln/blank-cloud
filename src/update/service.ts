import { spawn } from "node:child_process";
import path from "node:path";
import { BUILD_INFO } from "../build-info.generated.js";
import {
  loadAppSettings,
  type UpdateSettings,
  updateAppSettings,
} from "../settings/store.js";
import { fetchRemoteCommit } from "./github.js";
import {
  canApplyUpdates,
  commitsMatch,
  DEFAULT_UPDATE_REF,
  getInstallDir,
  readLocalCommit,
} from "./meta.js";

let applyInFlight = false;
let schedulerStarted = false;

function defaultRef(settings = loadAppSettings()): string {
  return settings.update.ref?.trim() || DEFAULT_UPDATE_REF;
}

export function getUpdateStatus() {
  const settings = loadAppSettings();
  const localCommit = readLocalCommit();
  const remoteSha = settings.update.lastRemoteSha;
  const updateAvailable = Boolean(
    remoteSha && !commitsMatch(localCommit, remoteSha),
  );
  return {
    version: BUILD_INFO.version,
    localCommit,
    remoteCommit: remoteSha,
    remoteMessage: settings.update.lastRemoteMessage,
    remoteDate: settings.update.lastRemoteDate,
    updateAvailable,
    ref: defaultRef(settings),
    autoCheckEnabled: settings.update.autoCheckEnabled,
    autoApplyEnabled: settings.update.autoApplyEnabled,
    checkIntervalHours: settings.update.checkIntervalHours,
    lastCheckAt: settings.update.lastCheckAt,
    lastApplyAt: settings.update.lastApplyAt,
    lastError: settings.update.lastError,
    applyAvailable: canApplyUpdates(),
    installDir: getInstallDir(),
  };
}

export async function checkForUpdates(force = false): Promise<ReturnType<typeof getUpdateStatus>> {
  const settings = loadAppSettings();
  const ref = defaultRef(settings);
  try {
    const remote = await fetchRemoteCommit(ref);
    const localCommit = readLocalCommit();
    const updateAvailable = !commitsMatch(localCommit, remote.sha);
    updateAppSettings({
      update: {
        ...settings.update,
        lastCheckAt: new Date().toISOString(),
        lastRemoteSha: remote.sha,
        lastRemoteMessage: remote.message,
        lastRemoteDate: remote.date,
        lastError: null,
      },
    });
    const next = getUpdateStatus();
    if (updateAvailable && settings.update.autoApplyEnabled && canApplyUpdates()) {
      void applyUpdates("auto");
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAppSettings({
      update: {
        ...settings.update,
        lastCheckAt: new Date().toISOString(),
        lastError: message,
      },
    });
    if (force) {
      throw err;
    }
    return getUpdateStatus();
  }
}

export function patchUpdateSettings(patch: Partial<UpdateSettings>) {
  const settings = loadAppSettings();
  const next: UpdateSettings = {
    ...settings.update,
    ...patch,
  };
  if (next.checkIntervalHours < 1) {
    next.checkIntervalHours = 1;
  }
  if (next.checkIntervalHours > 168) {
    next.checkIntervalHours = 168;
  }
  updateAppSettings({ update: next });
  return getUpdateStatus();
}

export async function applyUpdates(source: "manual" | "auto" = "manual"): Promise<{
  started: boolean;
  message: string;
}> {
  if (applyInFlight) {
    return { started: false, message: "Update already in progress" };
  }
  if (!canApplyUpdates()) {
    return {
      started: false,
      message:
        "One-click apply is not enabled. Run on the host: cd ~/blank-cloud && bash scripts/update.sh",
    };
  }
  const install = getInstallDir()!;
  const script = path.join(install, "scripts", "update.sh");
  applyInFlight = true;
  const settings = loadAppSettings();
  const targetSha = settings.update.lastRemoteSha?.trim() ?? "";
  updateAppSettings({
    update: {
      ...settings.update,
      lastError: null,
    },
  });

  return new Promise((resolve) => {
    const child = spawn("bash", [script], {
      cwd: install,
      env: {
        ...process.env,
        BLANK_CLOUD_INSTALL_DIR: install,
        BLANK_CLOUD_REF: defaultRef(settings),
        ...(targetSha ? { BLANK_CLOUD_TARGET_COMMIT: targetSha } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (err) => {
      applyInFlight = false;
      const message = err.message;
      updateAppSettings({
        update: {
          ...loadAppSettings().update,
          lastError: message,
        },
      });
      resolve({ started: true, message });
    });
    child.on("close", (code) => {
      applyInFlight = false;
      const trimmed = out.trim().slice(-2000);
      if (code === 0) {
        updateAppSettings({
          update: {
            ...loadAppSettings().update,
            lastApplyAt: new Date().toISOString(),
            lastError: null,
          },
        });
        resolve({
          started: true,
          message:
            source === "auto"
              ? "Auto-update finished — container is restarting."
              : "Update finished — container is restarting.",
        });
      } else {
        const message = trimmed || `Update script exited with code ${code ?? "?"}`;
        updateAppSettings({
          update: {
            ...loadAppSettings().update,
            lastError: message,
          },
        });
        resolve({ started: true, message: `Update failed: ${message}` });
      }
    });
  });
}

export function startAutoUpdateScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const settings = loadAppSettings();
    if (!settings.update.autoCheckEnabled) return;
    const last = settings.update.lastCheckAt
      ? Date.parse(settings.update.lastCheckAt)
      : 0;
    const intervalMs = settings.update.checkIntervalHours * 60 * 60 * 1000;
    if (Number.isFinite(last) && Date.now() - last < intervalMs) {
      return;
    }
    void checkForUpdates(false);
  };

  setTimeout(tick, 15_000);
  setInterval(tick, 60 * 60 * 1000);
}
