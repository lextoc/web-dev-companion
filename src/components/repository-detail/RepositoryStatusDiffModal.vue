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
