import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppHeader from "./AppHeader.vue";

describe("AppHeader", () => {
  it("renders repository context, active script count, actions, and repository controls", async () => {
    const wrapper = mount(AppHeader, {
      props: {
        activeRepositoryName: "web-dev-companion",
        activeRepositoryPath: "/Users/alexanderclaes/web-dev-companion",
        activeScriptCount: 2,
        commandShortcutLabel: "Cmd+K",
      },
      slots: {
        "repository-controls": '<nav data-test="repository-controls">Controls</nav>',
      },
    });

    expect(wrapper.get("header").classes()).toContain("top-bar");
    expect(wrapper.get(".app-product-name").text()).toBe("Web Dev Companion");
    expect(wrapper.get("h1").text()).toBe("web-dev-companion");
    expect(wrapper.get(".app-context-line").text()).toBe(
      "/Users/alexanderclaes/web-dev-companion",
    );
    expect(wrapper.get(".state-chip.warning").text()).toBe("2 active");
    expect(wrapper.get(".command-palette-trigger").text()).toContain("Command");
    expect(wrapper.get("kbd").text()).toBe("Cmd+K");
    expect(wrapper.get('[data-test="repository-controls"]').text()).toBe(
      "Controls",
    );

    const buttons = wrapper.findAll("button");

    await wrapper.get(".command-palette-trigger").trigger("click");
    await buttons[1].trigger("click");

    expect(wrapper.emitted("commandPalette")).toHaveLength(1);
    expect(wrapper.emitted("settings")).toHaveLength(1);
  });

  it("renders default dashboard context without an active script chip", () => {
    const wrapper = mount(AppHeader, {
      props: {
        activeScriptCount: 0,
        commandShortcutLabel: "Ctrl+K",
      },
    });

    expect(wrapper.get(".app-product-name").text()).toBe("Web Dev Companion");
    expect(wrapper.get("h1").text()).toBe("Repositories");
    expect(wrapper.get(".app-context-line").text()).toBe(
      "Local repository dashboard",
    );
    expect(wrapper.find(".state-chip.warning").exists()).toBe(false);
  });
});
