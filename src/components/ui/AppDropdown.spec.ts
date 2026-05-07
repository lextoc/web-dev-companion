import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import AppDropdown from "./AppDropdown.vue";

const options = [
  { label: "Recent repositories", value: "recent" },
  { label: "All repositories", value: "all" },
  { label: "Pinned repositories", value: "pinned" },
];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AppDropdown", () => {
  it("opens option content in a teleport and emits the selected value", async () => {
    const wrapper = mount(AppDropdown, {
      attachTo: document.body,
      props: {
        id: "repository-filter",
        menuClass: "repository-filter-menu",
        modelValue: "recent",
        options,
      },
    });

    const trigger = wrapper.get("button.app-dropdown-button");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.text()).toContain("Recent repositories");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();

    await trigger.trigger("click");
    await nextTick();

    const menu = document.body.querySelector('[role="listbox"]');
    const optionButtons = document.body.querySelectorAll('[role="option"]');

    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(menu?.classList.contains("repository-filter-menu")).toBe(true);
    expect(menu?.getAttribute("aria-labelledby")).toBe("repository-filter");
    expect(optionButtons).toHaveLength(3);
    expect(optionButtons[0].classList.contains("active")).toBe(true);
    expect(optionButtons[0].getAttribute("aria-selected")).toBe("true");

    (optionButtons[1] as HTMLButtonElement).click();
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toEqual([["all"]]);
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();

    wrapper.unmount();
  });

  it("does not open when disabled", async () => {
    const wrapper = mount(AppDropdown, {
      attachTo: document.body,
      props: {
        disabled: true,
        modelValue: "recent",
        options,
      },
    });

    const trigger = wrapper.get("button.app-dropdown-button");

    expect(wrapper.classes()).toContain("disabled");
    expect(trigger.attributes()).toHaveProperty("disabled");

    await trigger.trigger("click");

    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();

    wrapper.unmount();
  });
});
