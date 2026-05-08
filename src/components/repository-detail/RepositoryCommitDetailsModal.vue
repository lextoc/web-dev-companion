<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { parseDiffOutput } from "../../output-formatting";
import type { CommitChangedFile, CommitDetails } from "../../repositories";

const props = defineProps<{
  commitDetails: CommitDetails | null;
  error: string | null;
  loadingHash: string | null;
}>();

defineEmits<{
  close: [];
}>();

const activeDiffSectionKey = ref<string | null>(null);
const diffSectionRefs = ref<Record<string, HTMLElement | null>>({});

const diffSections = computed(() => {
  const details = props.commitDetails;

  if (!details?.diff.trim()) {
    return [];
  }

  const rawSections: Array<{ path: string | null; lines: string[] }> = [];
  let currentSection: { path: string | null; lines: string[] } | null = null;

  for (const line of details.diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentSection) {
        rawSections.push(currentSection);
      }

      currentSection = {
        path: diffHeaderPath(line),
        lines: [line],
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        path: null,
        lines: [],
      };
    }

    currentSection.lines.push(line);
  }

  if (currentSection) {
    rawSections.push(currentSection);
  }

  return rawSections.map((section, sectionIndex) => {
    const fileIndex = commitFileIndexForDiffSection(details.files, section.path, sectionIndex);
    const file = fileIndex === -1 ? undefined : details.files[fileIndex];
    const path = section.path ?? file?.path ?? `Patch ${sectionIndex + 1}`;
    const key = file ? commitFileKey(file, fileIndex) : `diff-section:${sectionIndex}:${path}`;

    return {
      key,
      path,
      originalPath: file?.originalPath,
      lines: parseDiffOutput(section.lines.join("\n")),
    };
  });
});

const modalTitle = computed(() => {
  if (props.error) {
    return "Could not load commit details";
  }

  return props.commitDetails?.message ?? "Loading commit details...";
});

watch(
  () => [props.commitDetails?.fullHash, props.loadingHash] as const,
  () => {
    activeDiffSectionKey.value = null;
    diffSectionRefs.value = {};
  },
);

function formatLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fullLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function fileChangeSummary(file: CommitChangedFile) {
  const additions = file.additions === undefined ? "" : `+${file.additions}`;
  const deletions = file.deletions === undefined ? "" : `-${file.deletions}`;

  return [additions, deletions].filter(Boolean).join(" ");
}

function commitFileKey(file: CommitChangedFile, index: number) {
  return `${index}:${file.originalPath ?? ""}:${file.path}`;
}

function diffHeaderPath(line: string) {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);

  return match?.[2] ?? null;
}

function commitFileIndexForDiffSection(
  files: CommitChangedFile[],
  sectionPath: string | null,
  sectionIndex: number,
) {
  if (sectionPath) {
    const pathIndex = files.findIndex(
      (file) => file.path === sectionPath || file.originalPath === sectionPath,
    );

    if (pathIndex !== -1) {
      return pathIndex;
    }
  }

  return files[sectionIndex] ? sectionIndex : -1;
}

function commitDiffSectionKey(file: CommitChangedFile, index: number) {
  const fileKey = commitFileKey(file, index);
  const matchingSection =
    diffSections.value.find((section) => section.key === fileKey) ??
    diffSections.value.find(
      (section) =>
        section.path === file.path ||
        (Boolean(file.originalPath) && section.originalPath === file.originalPath),
    );

  return matchingSection?.key ?? null;
}

function setDiffSectionRef(key: string, element: unknown) {
  diffSectionRefs.value[key] = element instanceof HTMLElement ? element : null;
}

function scrollToCommitFile(file: CommitChangedFile, index: number) {
  const sectionKey = commitDiffSectionKey(file, index);

  if (!sectionKey) {
    return;
  }

  activeDiffSectionKey.value = sectionKey;
  diffSectionRefs.value[sectionKey]?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}
</script>

<template>
  <div
    class="modal-backdrop commit-detail-backdrop"
    role="presentation"
    @click.self="$emit('close')"
  >
    <section
      class="commit-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-detail-title"
      aria-live="polite"
    >
      <header class="commit-detail-header">
        <div class="commit-detail-title-row">
          <div>
            <span>Commit details</span>
            <h2 id="commit-detail-title">{{ modalTitle }}</h2>
          </div>
          <button type="button" class="secondary" @click="$emit('close')">Close</button>
        </div>
        <code v-if="commitDetails" :title="commitDetails.fullHash">
          {{ commitDetails.fullHash }}
        </code>
      </header>

      <div v-if="error" class="commit-detail-empty error">
        {{ error }}
      </div>

      <div
        v-else-if="loadingHash && !commitDetails"
        class="commit-detail-empty"
      >
        Loading commit details...
      </div>

      <template v-else-if="commitDetails">
        <div class="commit-detail-scroll">
          <p v-if="commitDetails.body" class="commit-detail-body">
            {{ commitDetails.body }}
          </p>

          <dl class="commit-detail-meta">
            <div>
              <dt>Author</dt>
              <dd>
                <span>{{ commitDetails.authorName }}</span>
                <small>{{ commitDetails.authorEmail }}</small>
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>
                <time
                  :datetime="commitDetails.dateTime"
                  :title="fullLogDate(commitDetails.dateTime)"
                >
                  {{ formatLogDate(commitDetails.dateTime) }}
                </time>
                <small>{{ commitDetails.time }}</small>
              </dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>
                <span>{{ commitDetails.files.length }}</span>
                <small>changed</small>
              </dd>
            </div>
          </dl>

          <div class="commit-detail-content">
            <section class="commit-files-section">
              <div class="commit-detail-section-heading">
                <h4>Changed files</h4>
                <span>{{ commitDetails.files.length }}</span>
              </div>
              <ul v-if="commitDetails.files.length > 0" class="commit-file-list">
                <li
                  v-for="(file, index) in commitDetails.files"
                  :key="`${file.status}-${file.path}`"
                >
                  <button
                    type="button"
                    class="commit-file-button"
                    :class="{ active: activeDiffSectionKey === commitDiffSectionKey(file, index) }"
                    :disabled="!commitDiffSectionKey(file, index)"
                    @click="scrollToCommitFile(file, index)"
                  >
                    <span class="commit-file-status">{{ file.status }}</span>
                    <span class="commit-file-path">
                      <strong>{{ file.path }}</strong>
                      <small v-if="file.originalPath">from {{ file.originalPath }}</small>
                    </span>
                    <code v-if="fileChangeSummary(file)">{{ fileChangeSummary(file) }}</code>
                  </button>
                </li>
              </ul>
              <p v-else class="commit-detail-empty compact">
                No changed files found for this commit.
              </p>
            </section>

            <section class="commit-diff-section">
              <div class="commit-detail-section-heading">
                <h4>Patch</h4>
              </div>
              <div v-if="diffSections.length > 0" class="commit-diff-file-list">
                <article
                  v-for="section in diffSections"
                  :key="section.key"
                  :ref="(element) => setDiffSectionRef(section.key, element)"
                  class="commit-diff-file"
                  :class="{ active: activeDiffSectionKey === section.key }"
                >
                  <div class="commit-diff-file-heading">
                    <strong>{{ section.path }}</strong>
                    <small v-if="section.originalPath">from {{ section.originalPath }}</small>
                  </div>
                  <pre class="status-diff-output commit-diff-output"><code><span
                    v-for="line in section.lines"
                    :key="line.key"
                    class="diff-line"
                    :class="line.className"
                  ><span class="diff-line-prefix">{{ line.prefix }}</span><span>{{ line.content }}</span></span></code></pre>
                </article>
              </div>
              <p v-else class="commit-detail-empty compact">
                No patch available for this commit.
              </p>
            </section>
          </div>
        </div>
      </template>
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

.commit-detail-backdrop {
  z-index: 35;
}

.commit-detail-modal {
  display: grid;
  width: min(1120px, 100%);
  height: min(760px, calc(100vh - 48px));
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: start;
  gap: 14px;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  padding: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: none;
}

.commit-detail-header {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.commit-detail-title-row {
  display: flex;
  min-width: 0;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.commit-detail-title-row > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.commit-detail-header span,
.commit-detail-section-heading span,
.commit-file-status {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.commit-detail-header h2 {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-heading);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-detail-header code {
  overflow: hidden;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-detail-body {
  margin: 0;
  border-radius: 7px;
  padding: 10px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  color: var(--muted-strong);
  font-size: var(--font-size-base);
  line-height: 1.5;
  white-space: pre-wrap;
}

.commit-detail-scroll {
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.commit-detail-content {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(260px, 0.44fr) minmax(0, 1fr);
  gap: 12px;
}

.commit-detail-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.commit-detail-meta div {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--border-soft) 76%, transparent);
  border-radius: 7px;
  padding: 9px;
  background: color-mix(in srgb, var(--surface) 64%, transparent);
}

.commit-detail-meta dt {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.commit-detail-meta dd {
  display: grid;
  gap: 2px;
  min-width: 0;
  margin: 0;
}

.commit-detail-meta span,
.commit-detail-meta time {
  overflow: hidden;
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-detail-meta small {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-files-section,
.commit-diff-section {
  display: grid;
  align-content: start;
  gap: 8px;
}

.commit-detail-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.commit-detail-section-heading h4 {
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-base);
}

.commit-detail-section-heading span {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
}

.commit-file-list {
  display: grid;
  gap: 6px;
  align-content: start;
  max-height: clamp(180px, calc(100vh - 340px), 440px);
  margin: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0;
  padding-right: 6px;
  list-style: none;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.commit-file-list li {
  min-width: 0;
}

.commit-file-button {
  display: grid;
  width: 100%;
  min-height: 0;
  grid-template-columns: 74px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 76%, transparent);
  border-radius: 7px;
  padding: 8px;
  background: color-mix(in srgb, var(--surface) 66%, transparent);
  color: var(--text);
  text-align: left;
}

.commit-file-button:hover:not(:disabled),
.commit-file-button.active {
  border-color: color-mix(in srgb, var(--brand) 54%, var(--border-soft));
  background: color-mix(in srgb, var(--brand) 8%, var(--surface));
  color: var(--text);
}

.commit-file-button:disabled {
  cursor: default;
  opacity: 1;
}

.commit-file-path {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.commit-file-path strong,
.commit-file-path small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-file-path strong {
  color: var(--text);
  font-size: var(--font-size-base);
}

.commit-file-path small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.commit-file-button code {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  white-space: nowrap;
}

.git-status-card,
.commit-detail-scroll,
.commit-file-list,
.commit-diff-file-list {
  scrollbar-color: color-mix(in srgb, var(--muted) 58%, transparent) transparent;
}

.git-status-card::-webkit-scrollbar,
.commit-detail-scroll::-webkit-scrollbar,
.commit-file-list::-webkit-scrollbar,
.commit-diff-file-list::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.git-status-card::-webkit-scrollbar-track,
.commit-detail-scroll::-webkit-scrollbar-track,
.commit-file-list::-webkit-scrollbar-track,
.commit-diff-file-list::-webkit-scrollbar-track,
.git-status-card::-webkit-scrollbar-corner,
.commit-detail-scroll::-webkit-scrollbar-corner,
.commit-file-list::-webkit-scrollbar-corner,
.commit-diff-file-list::-webkit-scrollbar-corner {
  background: transparent;
}

.git-status-card::-webkit-scrollbar-thumb,
.commit-detail-scroll::-webkit-scrollbar-thumb,
.commit-file-list::-webkit-scrollbar-thumb,
.commit-diff-file-list::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--muted) 42%, transparent);
  background-clip: content-box;
}

.git-status-card::-webkit-scrollbar-thumb:hover,
.commit-detail-scroll::-webkit-scrollbar-thumb:hover,
.commit-file-list::-webkit-scrollbar-thumb:hover,
.commit-diff-file-list::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--muted-strong) 58%, transparent);
}

.commit-diff-file-list {
  display: grid;
  min-height: 220px;
  max-height: min(520px, 56vh);
  gap: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 6px;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  scrollbar-gutter: stable;
}

.commit-diff-file {
  display: grid;
  min-width: 0;
  gap: 6px;
  scroll-margin-top: 6px;
}

.commit-diff-file.active .commit-diff-file-heading {
  border-color: color-mix(in srgb, var(--brand) 52%, var(--border-soft));
  background: color-mix(in srgb, var(--brand) 8%, var(--surface));
}

.commit-diff-file-heading {
  display: grid;
  min-width: 0;
  gap: 2px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 76%, transparent);
  border-radius: 7px;
  padding: 7px 9px;
  background: color-mix(in srgb, var(--surface) 66%, transparent);
}

.commit-diff-file-heading strong,
.commit-diff-file-heading small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-diff-file-heading strong {
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.commit-diff-file-heading small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
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
  overflow: auto;
  border-color: var(--diff-border);
  margin: 0;
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

.commit-diff-output {
  min-height: 0;
  max-height: none;
  border-radius: 7px;
}

.commit-detail-empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  border: 1px dashed var(--border-soft);
  border-radius: 8px;
  padding: 18px;
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 800;
  text-align: center;
}

.commit-detail-empty.compact {
  min-height: 0;
  margin: 0;
}

.commit-detail-empty.error {
  border-color: color-mix(in srgb, var(--danger) 34%, var(--border-soft));
  color: var(--danger);
}
</style>
