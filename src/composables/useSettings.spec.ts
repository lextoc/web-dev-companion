import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStateApi, PersistedAppState } from "../app-state";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../settings";
import { useSettings } from "./useSettings";

function persistedState(settings: Partial<AppSettings>): PersistedAppState {
  return {
    settings: settings as AppSettings,
    pinnedRepositoryPaths: [],
    pinnedScripts: [],
    recentCommandIds: [],
    repositoryBranchLinks: [],
  };
}

function installAppStateApi(overrides: Partial<AppStateApi> = {}) {
  const appState = {
    read: vi.fn().mockResolvedValue(persistedState(DEFAULT_APP_SETTINGS)),
    saveSettings: vi.fn(async (settings: AppSettings) => settings),
    savePinnedRepositoryPaths: vi.fn(),
    savePinnedScripts: vi.fn(),
    saveRecentCommandIds: vi.fn(),
    saveRepositoryBranchLinks: vi.fn(),
    ...overrides,
  };

  Object.defineProperty(window, "appState", {
    configurable: true,
    value: appState as unknown as AppStateApi,
  });

  return appState;
}

describe("useSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
  });

  it("loads persisted settings through normalization and applies the theme", async () => {
    installAppStateApi({
      read: vi.fn().mockResolvedValue(persistedState({
        autoRefreshIntervalMs: 0,
        commitCelebrations: false,
        editorCommand: "cursor",
        skipBranchSyncConfirmation: true,
        themeMode: "dark",
      })),
    });
    document.documentElement.dataset.density = "compact";
    const settings = useSettings();

    await settings.loadAppSettings();

    expect(settings.appSettings.value).toEqual({
      ...DEFAULT_APP_SETTINGS,
      commitCelebrations: false,
      editorCommand: "cursor",
      skipBranchSyncConfirmation: true,
      themeMode: "dark",
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.density).toBeUndefined();
  });

  it("falls back to defaults and clears explicit theme when persisted settings cannot load", async () => {
    installAppStateApi({
      read: vi.fn().mockRejectedValue(new Error("state unavailable")),
    });
    document.documentElement.dataset.theme = "light";
    const settings = useSettings();

    await settings.loadAppSettings();

    expect(settings.appSettings.value).toEqual(DEFAULT_APP_SETTINGS);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("saves normalized settings, applies the saved value, and closes the panel", async () => {
    const appState = installAppStateApi();
    const settings = useSettings();
    settings.isSettingsOpen.value = true;

    await settings.saveAppSettings({
      autoRefreshIntervalMs: -1,
      commitCelebrations: false,
      editorCommand: "zed",
      skipBranchSyncConfirmation: true,
      themeMode: "neon",
    } as unknown as AppSettings);

    const normalizedSettings = {
      ...DEFAULT_APP_SETTINGS,
      commitCelebrations: false,
      editorCommand: "zed",
      skipBranchSyncConfirmation: true,
    };

    expect(appState.saveSettings).toHaveBeenCalledWith(normalizedSettings);
    expect(settings.appSettings.value).toEqual(normalizedSettings);
    expect(settings.isSettingsOpen.value).toBe(false);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
