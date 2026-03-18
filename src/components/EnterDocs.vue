<script setup lang="ts">
defineProps<{
  msg: string
}>()
</script>

<template>
  <h1>{{ msg }}</h1>
  <p>
    查看本站 VitePress 构建的文档：
    <a href="/docs/" target="_blank">Quick Start</a>
  </p>
</template>
