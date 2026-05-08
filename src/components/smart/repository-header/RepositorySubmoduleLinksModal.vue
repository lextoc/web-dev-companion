<script setup lang="ts">
import type { RepositoryDetails } from "../../../repositories";
import { AppButton, AppDropdown } from "../../ui";

defineProps<{
  dropdownOptions: Array<{ label: string; value: string }>;
  repositoryName: string;
  rows: Array<{
    current: boolean;
    parentBranch: string;
    submoduleBranch: string;
  }>;
  selectedSubmodule: RepositoryDetails["gitSubmodules"][number];
  selectedSubmodulePath: string;
}>();

defineEmits<{
  close: [];
  updateLink: [parentBranch: string, submoduleBranchValue: string | number];
}>();
</script>

<template>
  <div
    class="modal-backdrop submodule-link-modal-backdrop"
    role="presentation"
    @click.self="$emit('close')"
  >
    <section
      id="submodule-branch-link-modal"
      class="submodule-link-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submodule-branch-link-title"
      @keydown.esc.stop.prevent="$emit('close')"
    >
      <div class="panel-heading submodule-link-modal-heading">
        <div>
          <h3 id="submodule-branch-link-title">Branch links</h3>
          <span class="panel-subtitle">{{ repositoryName }} - {{ selectedSubmodule.path }}</span>
        </div>
        <AppButton
          variant="secondary"
          size="icon"
          icon="close"
          class="branch-menu-close"
          aria-label="Close branch links"
          title="Close"
          @click="$emit('close')"
        >
          Close
        </AppButton>
      </div>

      <div
        id="submodule-branch-link-table"
        class="submodule-link-table"
        role="table"
        aria-label="Repository branch links"
      >
        <div class="submodule-link-table-head" role="row">
          <span role="columnheader">Repository branch</span>
          <span role="columnheader">Submodule branch</span>
        </div>
        <div
          v-for="row in rows"
          :key="`${selectedSubmodulePath}:${row.parentBranch}`"
          class="submodule-link-table-row"
          :class="{ current: row.current }"
          role="row"
        >
          <div class="submodule-link-parent-cell" role="cell">
            <strong>{{ row.parentBranch }}</strong>
            <small>{{ row.current ? "Current branch" : "Repository branch" }}</small>
          </div>
          <AppDropdown
            :model-value="row.submoduleBranch"
            menu-class="remote-branch-dropdown-menu submodule-link-dropdown-menu"
            :options="dropdownOptions"
            @update:model-value="$emit('updateLink', row.parentBranch, $event)"
          />
        </div>
      </div>
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

.submodule-link-modal-backdrop {
  z-index: 62;
  background: rgba(4, 8, 12, 0.42);
}

.branch-menu-panel {
  display: grid;
  width: min(1120px, 100%);
  height: min(760px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  border: 1px solid var(--border-control);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.submodule-link-modal {
  display: grid;
  width: min(640px, 100%);
  max-height: min(620px, calc(100vh - 80px));
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
  border: 1px solid var(--border-control);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.submodule-link-modal-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.submodule-link-modal .submodule-link-table {
  max-height: none;
  min-height: 0;
}

:deep(.submodule-link-dropdown-menu) {
  z-index: 70;
}

.branch-menu-close {
  width: 30px;
  min-height: 30px;
  padding: 0;
}
.submodule-link-table {
  display: grid;
  max-height: 220px;
  gap: 5px;
  overflow: auto;
  border-radius: 7px;
  padding: 6px;
  background: color-mix(in srgb, var(--surface-soft) 76%, var(--surface));
}

.submodule-link-table-head,
.submodule-link-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(128px, 1fr);
  gap: 7px;
  align-items: center;
}

.submodule-link-table-head {
  padding: 0 4px 2px;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.submodule-link-table-row {
  border: 1px solid color-mix(in srgb, var(--border-control) 58%, transparent);
  border-radius: 6px;
  padding: 5px;
  background: var(--surface);
}

.submodule-link-table-row.current {
  border-color: color-mix(in srgb, var(--focus) 48%, var(--border-control));
}

.submodule-link-parent-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.submodule-link-parent-cell strong,
.submodule-link-parent-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-link-parent-cell strong {
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.submodule-link-parent-cell small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.submodule-link-table .app-dropdown {
  min-width: 0;
}

.submodule-link-table :deep(.app-dropdown-button) {
  min-height: 28px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading > div {
  min-width: 0;
}

.panel-subtitle {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}
</style>
