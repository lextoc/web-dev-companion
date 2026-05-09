import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ProjectHealth, ProjectTask, ScriptTerminal } from "../../../repositories";
import RunProjectHealthScriptsButton from "./RunProjectHealthScriptsButton.vue";

function health(overrides: Partial<ProjectHealth> = {}): ProjectHealth {
  return {
    repoPath: "/work/app",
    checkedAt: "2026-05-09T12:00:00.000Z",
    packageJsonPresent: true,
    packageManager: {
      detected: "pnpm",
      declared: "pnpm",
      lockfiles: ["pnpm-lock.yaml"],
      status: "ok",
      messages: [],
    },
    node: {
      current: "20.19.4",
      configured: "20.19.4",
      engineRange: ">=20",
      status: "ok",
      messages: [],
    },
    java: {
      current: undefined,
      compiler: undefined,
      compilerMajor: undefined,
      configured: undefined,
      requiredRelease: undefined,
      requiredMajor: undefined,
      javaHome: undefined,
      maven: undefined,
      mavenWrapperPresent: false,
      gradleWrapperPresent: false,
      status: "ok",
      messages: [],
    },
    install: {
      installed: true,
      status: "ok",
      messages: [],
    },
    lockfile: {
      present: true,
      dirty: false,
      stale: false,
      status: "ok",
      messages: [],
    },
    dependencies: {
      status: "idle",
    },
    scripts: [],
    ...overrides,
  };
}

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "lint",
    name: "Lint",
    command: "pnpm lint",
    source: "node",
    ...overrides,
  };
}

function terminal(overrides: Partial<ScriptTerminal> = {}): ScriptTerminal {
  return {
    runId: "run-1",
    repoPath: "/work/app",
    repoName: "app",
    taskId: "lint",
    taskName: "Lint",
    source: "node",
    command: "pnpm lint",
    output: "",
    isRunning: false,
    startedAt: 0,
    exitCode: null,
    signal: null,
    ...overrides,
  };
}

describe("RunProjectHealthScriptsButton", () => {
  it("runs available scripts and restarts stopped script terminals while skipping running ones", async () => {
    const wrapper = mount(RunProjectHealthScriptsButton, {
      props: {
        health: health({
          scripts: [
            { name: "lint", command: "pnpm lint", present: true, status: "idle" },
            { name: "test", command: "pnpm test", present: true, status: "idle" },
            { name: "build", command: "pnpm build", present: true, status: "idle" },
            { name: "missing", present: false, status: "skipped" },
          ],
        }),
        scriptTerminalsByScript: {
          test: terminal({ taskId: "test", taskName: "test", isRunning: false }),
          build: terminal({ taskId: "build", taskName: "build", isRunning: true }),
        },
      },
    });

    const button = wrapper.get("button");

    expect(button.text()).toBe("Check health");
    expect(button.attributes("title")).toBe("Run available common Node scripts to check project health.");
    expect(button.attributes("disabled")).toBeUndefined();

    await button.trigger("click");

    expect(wrapper.emitted("runScript")).toEqual([["lint"]]);
    expect(wrapper.emitted("restartScript")).toEqual([["test"]]);
  });

  it("emits task events in task mode", async () => {
    const wrapper = mount(RunProjectHealthScriptsButton, {
      props: {
        runLabel: "Run checks",
        tasks: [
          task({ id: "lint", name: "Lint" }),
          task({ id: "test", name: "Test", command: "pnpm test" }),
          task({ id: "typecheck", name: "Typecheck", command: "pnpm typecheck" }),
        ],
        taskTerminalsByTask: {
          test: terminal({ taskId: "test", taskName: "Test", isRunning: false }),
          typecheck: terminal({ taskId: "typecheck", taskName: "Typecheck", isRunning: true }),
        },
      },
    });

    const button = wrapper.get("button");

    expect(button.text()).toBe("Run checks");
    expect(button.attributes("title")).toBe("Run available project tasks.");

    await button.trigger("click");

    expect(wrapper.emitted("runTask")).toEqual([["lint"]]);
    expect(wrapper.emitted("restartTask")).toEqual([["test"]]);
  });

  it("disables the button when no checks can be started", async () => {
    const wrapper = mount(RunProjectHealthScriptsButton, {
      props: {
        tasks: [task()],
        taskTerminalsByTask: {
          lint: terminal({ isRunning: true }),
        },
      },
    });

    const button = wrapper.get("button");

    expect(button.text()).toBe("Tasks running");
    expect(button.attributes("title")).toBe("All available tasks are already running.");
    expect(button.attributes("disabled")).toBeDefined();

    await button.trigger("click");

    expect(wrapper.emitted()).not.toHaveProperty("runTask");
    expect(wrapper.emitted()).not.toHaveProperty("restartTask");
  });
});
