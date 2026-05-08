<script setup lang="ts">
import { computed } from "vue";
import { parseDiffOutput } from "../../output-formatting";
import type { StatusFileDiff } from "../../repositories";

const props = defineProps<{
  error: string | null;
  statusDiff: StatusFileDiff | null;
}>();

defineEmits<{
  close: [];
}>();

const diffLines = computed(() => parseDiffOutput(props.statusDiff?.content ?? ""));
</script>

<template>
  <div
    class="modal-backdrop status-diff-backdrop"
    role="presentation"
    @click.self="$emit('close')"
  >
    <section class="status-diff-modal" role="dialog" aria-modal="true" aria-labelledby="status-diff-title">
      <header class="status-diff-header">
        <div>
          <span>File changes</span>
          <h2 id="status-diff-title">
            {{ statusDiff?.path ?? "Could not load changes" }}
          </h2>
        </div>
        <button type="button" class="secondary" @click="$emit('close')">Close</button>
      </header>

      <p v-if="error" class="status-diff-error">{{ error }}</p>
      <pre v-else class="status-diff-output"><code><span
        v-for="line in diffLines"
        :key="line.key"
        class="diff-line"
        :class="line.className"
      ><span class="diff-line-prefix">{{ line.prefix }}</span><span>{{ line.content }}</span></span></code></pre>
    </section>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.status-diff-backdrop {
  z-index: 35;
}

.status-diff-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1120px, 100%);
  height: min(760px, calc(100vh - 48px));
  gap: 12px;
  border: 0;
  border-radius: 8px;
  padding: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: none;
}

.status-diff-header {
  display: flex;
  min-width: 0;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.status-diff-header div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.status-diff-header span {
  color: var(--brand);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.status-diff-header h2 {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  font-size: var(--font-size-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-diff-output {
  --diff-bg: #ffffff;
  --diff-border: #bfccd6;
  --diff-text: #26343f;
  --diff-muted: #72808b;
  --diff-blue: #1d5d96;
  --diff-hunk-bg: #e7f1fb;
  --diff-green: #17633e;
  --diff-added-bg: #e7f6ed;
  --diff-red: #a4382e;
  --diff-removed-bg: #fff0ed;
  min-height: 0;
  max-height: none;
  border-color: var(--diff-border);
  background: var(--diff-bg);
  color: var(--diff-text);
  font-size: var(--font-size-base);
  line-height: 1.56;
  white-space: pre;
}

@media (prefers-color-scheme: dark) {
  :global(:root:not([data-theme])) .status-diff-output {
    --diff-bg: #0d1319;
    --diff-border: #263641;
    --diff-text: #d6e0e6;
    --diff-muted: #7f8f9b;
    --diff-blue: #83bdf7;
    --diff-hunk-bg: #162637;
    --diff-green: #8bdca8;
    --diff-added-bg: #0f2b20;
    --diff-red: #f09b93;
    --diff-removed-bg: #351919;
  }
}

:global(:root[data-theme="dark"]) .status-diff-output {
  --diff-bg: #0d1319;
  --diff-border: #263641;
  --diff-text: #d6e0e6;
  --diff-muted: #7f8f9b;
  --diff-blue: #83bdf7;
  --diff-hunk-bg: #162637;
  --diff-green: #8bdca8;
  --diff-added-bg: #0f2b20;
  --diff-red: #f09b93;
  --diff-removed-bg: #351919;
}

.status-diff-output code {
  display: grid;
  min-width: max-content;
  font: inherit;
}

.diff-line {
  display: grid;
  grid-template-columns: 2ch minmax(0, 1fr);
  min-height: 1.56em;
  padding: 0 8px;
  color: var(--diff-text);
}

.diff-line-prefix {
  color: var(--diff-muted);
  user-select: none;
}

.diff-line-file {
  color: var(--diff-blue);
}

.diff-line-hunk {
  background: var(--diff-hunk-bg);
  color: var(--diff-blue);
}

.diff-line-added {
  background: var(--diff-added-bg);
  color: var(--diff-green);
}

.diff-line-removed {
  background: var(--diff-removed-bg);
  color: var(--diff-red);
}

.diff-line-file .diff-line-prefix,
.diff-line-hunk .diff-line-prefix {
  color: color-mix(in srgb, var(--diff-blue) 72%, var(--diff-muted));
}

.diff-line-added .diff-line-prefix {
  color: color-mix(in srgb, var(--diff-green) 72%, var(--diff-muted));
}

.diff-line-removed .diff-line-prefix {
  color: color-mix(in srgb, var(--diff-red) 72%, var(--diff-muted));
}

.status-diff-error {
  border-radius: 7px;
  margin: 0;
  padding: 10px 12px;
  background: var(--danger-soft);
  color: var(--danger-text);
  font-weight: 800;
}

@media (max-width: 760px) {
  .status-diff-modal {
    height: calc(100vh - 32px);
    padding: 12px;
  }

  .status-diff-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
