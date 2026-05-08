<script setup lang="ts">
import type { RepositoryDetails } from "../../repositories";

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
