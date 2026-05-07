import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppCheckbox from "./AppCheckbox.vue";

describe("AppCheckbox", () => {
  it("renders label text, description, and checked state", () => {
    const wrapper = mount(AppCheckbox, {
      props: {
        description: "Run checks before opening a repository.",
        modelValue: true,
      },
      slots: {
        default: "Enable health checks",
      },
    });

    const input = wrapper.get("input");

    expect(wrapper.classes()).toContain("app-checkbox");
    expect(input.attributes("type")).toBe("checkbox");
    expect((input.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.get("strong").text()).toBe("Enable health checks");
    expect(wrapper.get("small").text()).toBe(
      "Run checks before opening a repository.",
    );
  });

  it("emits the updated checked value when changed", async () => {
    const wrapper = mount(AppCheckbox, {
      props: {
        modelValue: false,
      },
      slots: {
        default: "Pin repository",
      },
    });

    await wrapper.get("input").setValue(true);

    expect(wrapper.emitted("update:modelValue")).toEqual([[true]]);
  });
});
