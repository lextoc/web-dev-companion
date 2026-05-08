<script setup lang="ts">
import type { RepositoryDetails } from "../../../repositories";

const props = defineProps<{
  commitDetailsLoadingHash: string | null;
  gitLog: RepositoryDetails["gitLog"];
  selectedCommitFullHash?: string;
  selectedCommitHash?: string;
}>();

defineEmits<{
  openCommitDetails: [entry: RepositoryDetails["gitLog"][number]];
  openCommitInBrowser: [hash: string];
}>();

const logDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return logDateFormatter.format(date);
}

function fullLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function isSelectedCommit(hash: string) {
  return (
    props.commitDetailsLoadingHash === hash ||
    props.selectedCommitHash === hash ||
    props.selectedCommitFullHash === hash
  );
}
</script>

<template>
  <section class="detail-panel git-log-panel">
    <div v-if="gitLog.length > 0" class="git-log-table-wrap">
      <table class="git-log-table">
        <thead>
          <tr>
            <th scope="col">Commit</th>
            <th scope="col">Message</th>
            <th scope="col">Author</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in gitLog"
            :key="entry.hash"
            :class="{ active: isSelectedCommit(entry.hash) }"
            tabindex="0"
            role="button"
            :aria-busy="commitDetailsLoadingHash === entry.hash"
            :aria-label="`View details for commit ${entry.hash}: ${entry.message}`"
            :title="`View details for ${entry.hash}`"
            @click="$emit('openCommitDetails', entry)"
            @keydown.enter.prevent="$emit('openCommitDetails', entry)"
            @keydown.space.prevent="$emit('openCommitDetails', entry)"
          >
            <td>
              <button
                type="button"
                class="commit-hash-button"
                :title="`Open commit ${entry.hash} in browser`"
                @click.stop="$emit('openCommitInBrowser', entry.hash)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                <code>{{ entry.hash }}</code>
              </button>
              <small v-if="commitDetailsLoadingHash === entry.hash">Loading...</small>
            </td>
            <td>
              <strong>{{ entry.message }}</strong>
            </td>
            <td>
              <span :title="entry.authorEmail">{{ entry.authorName }}</span>
            </td>
            <td>
              <time :datetime="entry.dateTime" :title="fullLogDate(entry.dateTime)">
                {{ formatLogDate(entry.dateTime) }}
              </time>
              <small>{{ entry.time }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="clean-state">
      No commits found.
    </div>
  </section>
</template>

<style scoped>
.git-log-table-wrap {
  max-height: none;
  overflow: visible;
}

.git-log-table {
  min-width: 640px;
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.git-log-table th,
.git-log-table td {
  border-bottom: 1px solid
    color-mix(in srgb, var(--border-soft) 72%, transparent);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

.git-log-table th {
  position: sticky;
  z-index: 1;
  top: 0;
  background: color-mix(in srgb, var(--surface) 92%, var(--surface-soft));
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.git-log-table th:nth-child(1),
.git-log-table td:nth-child(1) {
  width: 112px;
}

.git-log-table th:nth-child(3),
.git-log-table td:nth-child(3) {
  width: 190px;
}

.git-log-table th:nth-child(4),
.git-log-table td:nth-child(4) {
  width: 150px;
}

.git-log-table tbody tr {
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  cursor: pointer;
}

.git-log-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--surface-soft) 54%, var(--surface));
}

.git-log-table tbody tr:hover {
  background: var(--surface-hover);
}

.git-log-table tbody tr:focus-visible {
  position: relative;
  z-index: 2;
  outline: 2px solid color-mix(in srgb, var(--brand) 58%, transparent);
  outline-offset: -2px;
}

.git-log-table tbody tr.active {
  background: color-mix(in srgb, var(--brand) 12%, var(--surface));
}

.commit-hash-button {
  appearance: none;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.commit-hash-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand) 58%, transparent);
  outline-offset: 2px;
}

.git-log-table code {
  display: inline-grid;
  min-height: 24px;
  align-items: center;
  border-radius: 5px;
  padding: 0 7px;
  background: color-mix(in srgb, var(--brand) 10%, var(--surface));
  color: var(--brand-text-hover);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.git-log-table strong,
.git-log-table span,
.git-log-table time,
.git-log-table small {
  display: block;
  min-width: 0;
}

.git-log-table strong {
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: var(--font-size-base);
  line-height: 1.35;
}

.git-log-table span,
.git-log-table time {
  overflow: hidden;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-log-table small {
  margin-top: 2px;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
