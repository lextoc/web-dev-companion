import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppTabs from "./AppTabs.vue";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "scripts", label: "Scripts" },
  { key: "activity", label: "Activity" },
];

describe("AppTabs", () => {
  it("renders the selected tab, panel content, and ARIA relationships", async () => {
    const wrapper = mount(AppTabs, {
      props: {
        label: "Repository details",
        modelValue: "scripts",
        panelClass: "detail-panel",
        tablistClass: "detail-tabs",
        tabs,
      },
      slots: {
        activity: '<p data-test="activity-panel">Activity content</p>',
        overview: '<p data-test="overview-panel">Overview content</p>',
        scripts: '<p data-test="scripts-panel">Scripts content</p>',
      },
    });

    const tablist = wrapper.get('[role="tablist"]');
    const tabButtons = wrapper.findAll('[role="tab"]');
    const panel = wrapper.get('[role="tabpanel"]');

    expect(tablist.classes()).toContain("detail-tabs");
    expect(tablist.attributes("aria-label")).toBe("Repository details");
    expect(tabButtons).toHaveLength(3);
    expect(tabButtons[1].classes()).toContain("active");
    expect(tabButtons[1].attributes("id")).toBe("tab-scripts");
    expect(tabButtons[1].attributes("aria-selected")).toBe("true");
    expect(tabButtons[1].attributes("aria-controls")).toBe("panel-scripts");
    expect(tabButtons[1].attributes("tabindex")).toBe("0");
    expect(tabButtons[0].attributes("tabindex")).toBe("-1");
    expect(panel.classes()).toContain("detail-panel");
    expect(panel.attributes("id")).toBe("panel-scripts");
    expect(panel.attributes("aria-labelledby")).toBe("tab-scripts");
    expect(wrapper.get('[data-test="scripts-panel"]').text()).toBe(
      "Scripts content",
    );
    expect(wrapper.find('[data-test="overview-panel"]').exists()).toBe(false);

    await tabButtons[2].trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["activity"]]);
  });

  it("falls back to the first tab and emits keyboard navigation selections", async () => {
    const wrapper = mount(AppTabs, {
      props: {
        label: "Repository details",
        modelValue: "missing",
        tabs,
      },
      slots: {
        overview: "Overview content",
      },
    });

    const tabButtons = wrapper.findAll('[role="tab"]');

    expect(tabButtons[0].classes()).toContain("active");
    expect(wrapper.get('[role="tabpanel"]').attributes("id")).toBe(
      "panel-overview",
    );

    await tabButtons[0].trigger("keydown", { key: "ArrowRight" });
    await tabButtons[0].trigger("keydown", { key: "End" });

    expect(wrapper.emitted("update:modelValue")).toEqual([
      ["scripts"],
      ["activity"],
    ]);
  });
});
