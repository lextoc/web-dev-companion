import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppButton from "./AppButton.vue";

describe("AppButton", () => {
  it("renders button content with prop-driven type, variant, state, and icon classes", () => {
    const wrapper = mount(AppButton, {
      props: {
        active: true,
        icon: "folder",
        type: "submit",
        variant: "secondary",
      },
      slots: {
        default: "Open folder",
        trailing: '<span data-test="shortcut">Ctrl+O</span>',
      },
    });

    const button = wrapper.get("button");

    expect(button.attributes("type")).toBe("submit");
    expect(button.classes()).toContain("app-button");
    expect(button.classes()).toContain("active");
    expect(button.classes()).toContain("secondary");
    expect(button.classes()).toContain("app-button-with-icon");
    expect(button.classes()).not.toContain("danger");
    expect(button.classes()).not.toContain("app-button-icon-only");
    expect(wrapper.get(".button-icon").attributes("aria-hidden")).toBe("true");
    expect(button.text()).toContain("Open folder");
    expect(wrapper.get('[data-test="shortcut"]').text()).toBe("Ctrl+O");
  });

  it("visually hides the default slot label for icon-only buttons", () => {
    const wrapper = mount(AppButton, {
      props: {
        icon: "close",
        size: "icon",
        variant: "danger",
      },
      slots: {
        default: "Close panel",
      },
    });

    const button = wrapper.get("button");
    const label = wrapper.get(".visually-hidden");

    expect(button.attributes("type")).toBe("button");
    expect(button.classes()).toContain("app-button-icon-only");
    expect(button.classes()).toContain("subtle-icon-button");
    expect(button.classes()).toContain("danger");
    expect(button.classes()).not.toContain("app-button-with-icon");
    expect(label.text()).toBe("Close panel");
  });
});
