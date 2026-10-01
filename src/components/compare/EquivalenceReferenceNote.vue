<script setup lang="ts">
/**
 * 等价性徽章的参照系说明。
 *
 * 为什么需要它：徽章（= ≈ ≠ ∅）是**人手写的绝对值**（「Python 没有 var 提升」这类
 * 事实机器判不了），所以无法随运行时基准切换重算。而基准现在可以切到 Python / Java ——
 * 不说明的话，用户会以为徽章是「相对当前基准」的，这是架构里最容易误导人的一处。
 *
 * 参照系是构建期常量（registry.equivalenceReference），静态渲染与客户端一致。
 */
import { useI18n } from '@/composables/useI18n'
import { equivalenceReferenceName } from '@/generated/registry.gen'

const { t } = useI18n()
</script>

<template>
  <p class="pc-hint pc-ref-note">
    {{ t('baseline.referenceNote', { ref: equivalenceReferenceName }) }}
  </p>
</template>

<style scoped>
.pc-ref-note {
  margin: 0 0 12px;
  line-height: 1.6;
}
</style>
