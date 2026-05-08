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
