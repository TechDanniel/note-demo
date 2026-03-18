<script setup lang="ts">
import EnterDocs from './components/EnterDocs.vue'
</script>

<template>
  <div>
    <a href="https://vitepress.dev/" target="_blank">
      <img src="./assets/vitepress.svg" class="logo" alt="vitepress logo" />
    </a>
    <a href="javascript:;" target="_blank">
      <img src="./assets/note.jpeg" class="logo" alt="note logo" />
    </a>
  </div>
  <EnterDocs msg="开启note之旅" />
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
</style>
