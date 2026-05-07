<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";

type AppButtonVariant = "primary" | "secondary" | "danger";
type AppButtonSize = "default" | "icon";
type AppButtonType = "button" | "submit" | "reset";
type AppButtonIcon =
  | "arrow-left"
  | "command"
  | "copy"
  | "close"
  | "edit"
  | "folder"
  | "hide"
  | "more-horizontal"
  | "panel-hide"
  | "pin"
  | "pin-off"
  | "play"
  | "pull"
  | "push"
  | "repository"
  | "restart"
  | "stop"
  | "terminal"
  | "trash";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    icon?: AppButtonIcon;
    size?: AppButtonSize;
    type?: AppButtonType;
    variant?: AppButtonVariant;
  }>(),
  {
    active: false,
    size: "default",
    type: "button",
    variant: "primary",
  },
);

const buttonClasses = computed(() => ({
  active: props.active,
  "app-button": true,
  "app-button-icon-only": props.size === "icon",
  "app-button-with-icon": Boolean(props.icon) && props.size !== "icon",
  danger: props.variant === "danger",
  secondary: props.variant === "secondary",
  "subtle-icon-button": props.size === "icon",
}));
</script>

<template>
  <button :type="type" :class="buttonClasses">
    <AppIcon v-if="icon" :name="icon" class="button-icon" />
    <span v-if="$slots.default && size === 'icon'" class="visually-hidden">
      <slot />
    </span>
    <slot v-else />
    <slot name="trailing" />
  </button>
</template>
