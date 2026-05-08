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
