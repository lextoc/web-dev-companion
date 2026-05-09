import { describe, expect, it } from "vitest";
import type { ProjectHealth, ProjectTask } from "../../../repositories";
import { javaHealthSummary } from "./javaHealthSummary";
import { nodeHealthSummary } from "./nodeHealthSummary";
import { rubyHealthSummary } from "./rubyHealthSummary";

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "test",
    name: "test",
    command: "pnpm test",
    source: "node",
    ...overrides,
  };
}

function health(overrides: Partial<ProjectHealth> = {}): ProjectHealth {
  return {
    repoPath: "/work/app",
    checkedAt: "2026-05-09T12:00:00.000Z",
    packageJsonPresent: false,
    packageManager: {
      detected: undefined,
      declared: undefined,
      lockfiles: [],
      status: "ok",
      messages: [],
    },
    node: {
      current: undefined,
      configured: undefined,
      engineRange: undefined,
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
      present: false,
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

describe("health summaries", () => {
  it("summarizes Node health presence, warning status, and attention items", () => {
    const summary = nodeHealthSummary(health({
      packageJsonPresent: true,
      packageManager: {
        detected: "pnpm",
        declared: "npm",
        lockfiles: ["pnpm-lock.yaml", "package-lock.json"],
        status: "warning",
        messages: [{
          level: "warning",
          text: "Multiple package manager lockfiles found.",
        }],
      },
      node: {
        current: "20.19.4",
        configured: "20.19.4",
        engineRange: ">=20",
        status: "ok",
        messages: [],
      },
      dependencies: {
        status: "outdated",
        outdatedCount: 3,
      },
      scripts: [{
        name: "test",
        command: "pnpm test",
        present: true,
        status: "failed",
        exitCode: 1,
        error: "Tests failed.",
      }],
    }), []);

    expect(summary).toEqual({
      key: "node",
      present: true,
      status: "error",
      attentionItems: [
        {
          key: "package-Multiple package manager lockfiles found.",
          level: "warning",
          title: "Package manager",
          text: "Multiple package manager lockfiles found.",
        },
        {
          key: "dependencies-outdated",
          level: "warning",
          title: "Dependencies",
          text: "3 outdated dependencies found.",
        },
        {
          key: "script-test",
          level: "error",
          title: "test",
          text: "Tests failed.",
        },
      ],
    });
  });

  it("reports unknown Node health when detected but not fully known", () => {
    const summary = nodeHealthSummary(health({
      node: {
        current: undefined,
        configured: ".nvmrc",
        engineRange: undefined,
        status: "unknown",
        messages: [],
      },
    }), []);

    expect(summary.present).toBe(true);
    expect(summary.status).toBe("unknown");
    expect(summary.attentionItems).toEqual([]);
  });

  it("summarizes Java presence and message mapping", () => {
    const summary = javaHealthSummary(health({
      java: {
        current: "17",
        compiler: "javac 17",
        compilerMajor: 17,
        configured: undefined,
        requiredRelease: "21",
        requiredMajor: 21,
        javaHome: undefined,
        maven: undefined,
        mavenWrapperPresent: false,
        gradleWrapperPresent: true,
        status: "warning",
        messages: [{
          level: "warning",
          text: "Java 21 is required.",
        }],
      },
    }), []);

    expect(summary).toEqual({
      key: "java",
      present: true,
      status: "warning",
      attentionItems: [{
        key: "java-Java 21 is required.",
        level: "warning",
        title: "Java",
        text: "Java 21 is required.",
      }],
    });
  });

  it("uses task presence for Ruby health", () => {
    expect(rubyHealthSummary([])).toEqual({
      key: "ruby",
      present: false,
      status: "ok",
      attentionItems: [],
    });
    expect(rubyHealthSummary([task({
      id: "rails-server",
      name: "rails server",
      command: "bin/rails server",
      source: "rails",
    })]).present).toBe(true);
  });
});
