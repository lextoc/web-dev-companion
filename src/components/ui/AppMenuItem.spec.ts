import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppMenuItem from "./AppMenuItem.vue";

describe("AppMenuItem", () => {
  it("renders menu item content with prop-driven type, tone, and icon", () => {
    const wrapper = mount(AppMenuItem, {
      props: {
        icon: "trash",
        tone: "danger",
        type: "submit",
      },
      slots: {
        default: "Remove repository",
      },
    });

    const button = wrapper.get("button");

    expect(button.attributes("type")).toBe("submit");
    expect(button.attributes("role")).toBe("menuitem");
    expect(button.classes()).toContain("action-menu-item");
    expect(button.classes()).toContain("danger");
    expect(wrapper.get(".button-icon").attributes("aria-hidden")).toBe("true");
    expect(wrapper.get("span").text()).toBe("Remove repository");
  });

  it("uses default button styling and forwards click listeners", async () => {
    const onClick = vi.fn();
    const wrapper = mount(AppMenuItem, {
      attrs: {
        onClick,
      },
      slots: {
        default: "Open terminal",
      },
    });

    const button = wrapper.get("button");

    expect(button.attributes("type")).toBe("button");
    expect(button.classes()).toContain("action-menu-item");
    expect(button.classes()).not.toContain("danger");
    expect(wrapper.find(".button-icon").exists()).toBe(false);

    await button.trigger("click");

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
