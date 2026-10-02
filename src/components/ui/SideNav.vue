<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'
import { chapterPathOf, orderedSections, sectionUsesTarget, topicOf } from '@/content/repository'
import { sectionEntryPath, sectionOfRoute } from '@/router'
import { useLanguageStore } from '@/stores/language'
import { useUiStore } from '@/stores/ui'
import type { Section } from '@/schemas'

// 板块名取自注册表（def.label），不再走 i18n 的 nav.* —— 那组 key 按板块写死，
// 加板块时必须记得补，否则左栏显示裸 key
const route = useRoute()
const languages = useLanguageStore()
const ui = useUiStore()

const baseline = computed(() => languages.effectiveBaseline)

/**
 * 当前所在的板块，用来给一级项上一个"你在这里"的记号。
 *
 * 不能只靠 RouterLink 的 router-link-active：一级项的落点是**该板块的第一章**，
 * 读到第三章时它就不是 active 了 —— 而"我在基础语法里"这件事没变。
 */
const currentSection = computed<Section | null>(() => sectionOfRoute(route))

interface NavChild {
  to: string
  label: string
}
interface NavGroup {
  key: Section
  label: string
  to: string
  /**
   * 对级板块的「当前方向」，如 `JS→Py`。
   *
   * 为什么必须显式写出来：目标语言不进 URL，而 6 个迁移方向的章节标题目前
   * **完全同名**（都叫「1. 函数与参数传递」）。少了这一行，用户在页内换了方向后
   * 左栏一个字都不变，只有正文换了 —— 看起来像点错了。
   */
  hint: string
  /** 列表板块（陷阱/词典/路线）没有章节概念，二级为空 */
  children: NavChild[]
}

/**
 * 左侧全部是「多语言对比」的子菜单（五项，依次为
 * 基础语法 / 迁移教程 / 迁移陷阱 / 速语词典 / 迁移学习路线）。
 *
 * 二级项由 manifest 派生，**只对两个有章节的板块存在**：
 *  · basics    → 该基准下的章节
 *  · migration → 当前目标方向下的章节
 *
 * 陷阱 / 词典 / 路线**不再列目标语言** —— 它们在 P8 之后由页内的对比语言选择条
 * 决定方向，同一页重复列一遍 12 个方向只会让左栏变成一张菜单表。
 */
const groups = computed<NavGroup[]>(() => {
  const b = baseline.value

  /*
   * 对级章节板块展开的是**当前方向**的章节。
   *
   * 刻意不用 store 里的 `pairTarget`：那个跟着「当前所在板块」走，在基础语法页恒为
   * null —— 于是同一份左栏在基础语法页少一截、切到列表页又长出来，首页永远是空的。
   * 这里显式问「这个板块会选哪个方向」，左栏于是在任何页面都是同一份。
   */
  const chaptersFor = (section: Section): NavChild[] => {
    const target = languages.resolveTargetFor(section, b)
    return (topicOf(section, b, target ?? undefined)?.chapters ?? []).map((c) => ({
      to: chapterPathOf(c.id),
      label: c.title,
    }))
  }

  /** 短名 —— 左栏只有 236px，取不到就退回 id */
  const shortOf = (id: string): string => languages.metaOf(id)?.shortName ?? id

  return (
    orderedSections()
      .map((def): NavGroup => {
        // 与上面的 chaptersFor 同源，所以「左栏写的方向」与「左栏展开的章节」永远一致
        const target = sectionUsesTarget(def.id) ? languages.resolveTargetFor(def.id, b) : null
        return {
          key: def.id,
          label: def.label,
          hint: target ? `${shortOf(b)}→${shortOf(target)}` : '',
          to: sectionEntryPath(b, def.id),
          // 二级项只对**章节型**板块存在；列表型本身就是落点
          children: def.shape === 'chapter' ? chaptersFor(def.id) : [],
        }
      })
      // 该基准下没有内容的板块整组隐藏 —— 与 routes / sitemap 同源，不会有点进去是空页的死链
      .filter((g) => g.to !== '/404')
  )
})
</script>

<template>
  <!--
    id 是顶栏那个开合按钮的 aria-controls 落点。
    用 v-show 而不是 v-if：侧栏是纯展示结构，反复开合不该反复重建 DOM，
    而且 v-if 会让 aria-controls 指向一个不存在的元素。
  -->
  <aside v-show="ui.sideNavOpen" id="pc-sidenav" class="pc-side" aria-label="内容导航">
    <ul class="pc-snav">
      <li v-for="group in groups" :key="group.key" class="pc-snav-item">
        <RouterLink
          :to="group.to"
          class="pc-snav-link"
          :class="{
            'is-current': currentSection === group.key,
            'has-children': group.children.length > 0,
          }"
        >
          {{ group.label }}
          <!-- 对级板块的当前方向。不放进 RouterLink 的文本里，免得被读成标题的一部分 -->
          <span v-if="group.hint" class="pc-snav-hint">{{ group.hint }}</span>
        </RouterLink>

        <ul v-if="group.children.length" class="pc-snav-sub">
          <li v-for="child in group.children" :key="child.to">
            <RouterLink :to="child.to" class="pc-snav-link">{{ child.label }}</RouterLink>
          </li>
        </ul>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
/*
 * 左侧菜单：一级 = 板块，二级 = 章节。
 *
 * 层级同时由**五个信号**表达，缩进只是其中之一：字号（14→13）、字重（600→400）、
 * 颜色（正文色→次要色）、缩进（+13px）、以及子菜单左侧那条竖线。
 * 只靠缩进是不够的 —— 改版前一级项被 `.pc-tree a` 的 padding 推到 36px、
 * 二级项反而只有 32px，**子项看起来比父项还靠左**，层级是反的。
 */
.pc-snav {
  list-style: none;
  margin: 0;
  padding: 0;
}
/* 板块之间留出呼吸位，否则二级项会看起来像挂在下一个板块上 */
.pc-snav-item + .pc-snav-item {
  margin-top: 10px;
}

.pc-snav-link {
  display: block;
  margin: 0 8px;
  padding: 6px 10px;
  border-radius: var(--pc-radius);
  color: var(--pc-text);
  font-size: var(--pc-fs-base);
  font-weight: 600;
  line-height: 1.45;
}
.pc-snav-link:hover {
  background: var(--pc-bg-hover);
  text-decoration: none;
}

/* 「你在这个板块里」——只上主题色文字，底色留给真正命中的那一项 */
.pc-snav-link.is-current {
  color: var(--pc-accent);
}

/*
 * 当前方向（如 `JS→Py`）。用等宽字体 + 更小的字号，与中文标题拉开层次 ——
 * 它是一个「状态读数」，不是一个标题。允许换行：窄屏下 `Py→Java` 放不下时
 * 宁可折行，也不要被裁掉半截（那正是它存在要解决的问题）。
 */
.pc-snav-hint {
  margin-left: 6px;
  font-family: var(--pc-mono);
  font-size: var(--pc-fs-xs);
  font-weight: 400;
  color: var(--pc-text-mute);
}

/* 子菜单：竖线把它们和上面的板块绑在一起，不靠背景色去猜归属 */
.pc-snav-sub {
  list-style: none;
  margin: 2px 0 0 18px;
  padding: 0 0 0 7px;
  border-left: 1px solid var(--pc-border);
}
.pc-snav-sub .pc-snav-link {
  margin: 0;
  padding: 5px 10px;
  color: var(--pc-text-soft);
  font-size: var(--pc-fs-sm);
  font-weight: 400;
}

/*
 * 命中的那一项。放在最后：它与上面的子菜单规则同样是两个类，
 * 靠顺序取胜，改顺序会让子项的选中态被 `.pc-snav-sub` 那条盖掉。
 */
.pc-snav-link.router-link-active {
  background: var(--pc-accent-soft);
  color: var(--pc-accent);
  font-weight: 600;
}

/*
 * 有子项的板块不铺底色：命中的是它下面的某一章，一级项再亮一块的话，
 * 同一时刻会有两处高亮，反而看不出"我在哪一章"。
 * 它的"你在这里"由 .is-current 的主题色文字表达。
 * 没有子项的板块本身就是落点（陷阱/词典/路线），照常铺底色。
 */
.pc-snav-link.has-children.router-link-active {
  background: transparent;
}
</style>
