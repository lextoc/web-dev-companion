import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppIcon from "./AppIcon.vue";

describe("AppIcon", () => {
  it("renders an inaccessible decorative SVG with the app icon class", () => {
    const wrapper = mount(AppIcon, {
      props: {
        name: "folder",
      },
    });

    const svg = wrapper.get("svg");

    expect(svg.classes()).toContain("app-icon");
    expect(svg.attributes("viewBox")).toBe("0 0 24 24");
    expect(svg.attributes("aria-hidden")).toBe("true");
    expect(svg.attributes("focusable")).toBe("false");
    expect(wrapper.get("path").attributes("d")).toContain("M3 7.5");
  });

  it("renders the shape for the requested icon name", async () => {
    const wrapper = mount(AppIcon, {
      props: {
        name: "play",
      },
    });

    expect(wrapper.get("path").attributes("d")).toBe("M8 5v14l11-7z");

    await wrapper.setProps({ name: "more-horizontal" });

    expect(wrapper.find("path").exists()).toBe(false);
    expect(wrapper.findAll("circle")).toHaveLength(3);
  });
});
