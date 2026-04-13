<script setup lang="ts">
interface Item {
  label: string
  hint: string
}

const items: Item[] = [
  { label: '界面语言', hint: '多语言支持即将推出' },
  { label: '快捷键', hint: '自定义键盘快捷键即将推出' },
  { label: 'Git 操作偏好', hint: '默认 pull 策略、自动 fetch 间隔即将推出' },
]
</script>

<template>
  <div class="section">
    <div class="section-title">即将推出</div>
    <div class="placeholder-list">
      <div v-for="item in items" :key="item.label" class="placeholder-row">
        <div class="placeholder-label">{{ item.label }}</div>
        <div class="placeholder-hint">{{ item.hint }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.placeholder-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--border);
}

.placeholder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-primary);
  opacity: 0.55;
}

.placeholder-label {
  font-size: 12px;
  color: var(--text-primary);
}

.placeholder-hint {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
