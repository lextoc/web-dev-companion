<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { AppIcon } from "../../ui";

const props = defineProps<{
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  isDetailLoading: boolean;
}>();

defineEmits<{
  refresh: [];
}>();

const refreshButtonElement = ref<HTMLElement | null>(null);
const isRefreshIconSettling = ref(false);
const refreshIconStartAngle = ref(0);
const refreshIconEndAngle = ref(0);
const refreshIconSettleDuration = ref(0);
let refreshIconSettleTimer: number | undefined;

function currentRefreshIconAngle() {
  const iconElement = refreshButtonElement.value?.querySelector<HTMLElement>(".button-icon");

  if (!iconElement) {
    return 0;
  }

  const transform = window.getComputedStyle(iconElement).transform;

  if (!transform || transform === "none") {
    return 0;
  }

  const matrix = new DOMMatrixReadOnly(transform);
  const angle = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);

  return (angle + 360) % 360;
}

function prepareRefreshIconSettle() {
  const startAngle = currentRefreshIconAngle();
  const remainingAngle = startAngle === 0 ? 0 : 360 - startAngle;

  refreshIconStartAngle.value = startAngle;
  refreshIconEndAngle.value = remainingAngle === 0 ? 0 : 360;
  refreshIconSettleDuration.value = Math.round((remainingAngle / 360) * 900);
}

watch(
  () => props.isDetailLoading,
  (isDetailLoading, wasDetailLoading) => {
    if (refreshIconSettleTimer !== undefined) {
      window.clearTimeout(refreshIconSettleTimer);
      refreshIconSettleTimer = undefined;
    }

    if (isDetailLoading) {
      isRefreshIconSettling.value = false;
      return;
    }

    if (wasDetailLoading) {
      prepareRefreshIconSettle();
      isRefreshIconSettling.value = true;
      refreshIconSettleTimer = window.setTimeout(() => {
        isRefreshIconSettling.value = false;
        refreshIconSettleTimer = undefined;
      }, refreshIconSettleDuration.value);
    }
  },
);

onBeforeUnmount(() => {
  if (refreshIconSettleTimer !== undefined) {
    window.clearTimeout(refreshIconSettleTimer);
  }
});
</script>

<template>
  <button
    ref="refreshButtonElement"
    type="button"
    class="secondary refresh-button"
    :class="{ pending: isDetailLoading, settling: isRefreshIconSettling }"
    :style="{
      '--refresh-start-angle': `${refreshIconStartAngle}deg`,
      '--refresh-end-angle': `${refreshIconEndAngle}deg`,
      '--refresh-settle-duration': `${refreshIconSettleDuration}ms`,
    }"
    :disabled="isDetailLoading"
    :title="isDetailLoading ? 'Refreshing repository' : autoRefreshLabel"
    :aria-busy="isDetailLoading"
    :aria-label="isDetailLoading ? 'Refreshing repository' : 'Refresh repository'"
    @click="$emit('refresh')"
  >
    <AppIcon name="restart" class="button-icon" />
    <span class="refresh-button-label">Refresh</span>
    <span class="refresh-progress" aria-hidden="true">
      <span
        class="refresh-progress-fill"
        :style="{ width: `${autoRefreshProgress}%` }"
      ></span>
    </span>
  </button>
</template>

<style scoped>
.refresh-button {
  display: inline-flex;
  position: relative;
  overflow: hidden;
  min-height: 36px;
  align-items: center;
  gap: 7px;
  padding: 0 12px 4px;
}

.refresh-button :deep(.button-icon) {
  position: relative;
  z-index: 1;
  width: 15px;
  height: 15px;
  transform-origin: center;
  transition: opacity 180ms ease;
}

.refresh-button-label {
  position: relative;
  z-index: 1;
}

.refresh-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 999px;
  background: var(--border-soft);
}

.refresh-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand);
  transition: width 250ms linear;
}

.refresh-button:hover:not(:disabled) .refresh-progress-fill {
  background: var(--brand-hover);
}

.refresh-button.pending :deep(.button-icon) {
  animation: refresh-spin 900ms linear infinite;
}

.refresh-button.settling :deep(.button-icon) {
  animation: refresh-settle var(--refresh-settle-duration, 220ms) linear
    forwards;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes refresh-settle {
  from {
    transform: rotate(var(--refresh-start-angle, 0deg));
  }

  to {
    transform: rotate(var(--refresh-end-angle, 0deg));
  }
}
</style>
