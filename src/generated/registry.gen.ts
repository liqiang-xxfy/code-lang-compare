/* eslint-disable */
/*
 * AUTO-GENERATED FILE — 请勿手工编辑。
 * 源：content/registry.yaml + content/languages/<id>/meta.yaml
 * 重新生成：npm run registry（npm run content:build 会自动执行）
 * 生成时间：2026-10-02T14:26:32.737Z
 */
import type { LanguageMeta } from '../schemas'
export const allLanguageIds = ['arkts', 'dart', 'go', 'java', 'javascript', 'kotlin', 'python', 'rust', 'swift', 'typescript'] as const
export const enabledLanguageIds = ['go', 'java', 'javascript', 'python', 'rust'] as const

/** 全集：内容源（snippets.yaml）可以引用任意一门，哪怕是尚未启用的语言——这支持「先攒内容后启用」 */
export type AllLanguageId = (typeof allLanguageIds)[number]
export type LanguageId = AllLanguageId
/** 已启用：UI 只渲染这些列 */
export type EnabledLanguageId = (typeof enabledLanguageIds)[number]

export const publishPolicy = 'include-draft-with-badge' as const
/** 首访默认值与 SSG 静态文案使用的基准 */
export const defaultBaselineLanguageId = 'javascript' as const
/** 可作基准的语言（由各语言 meta.yaml 的 baseline: true 派生）。基准选择器只列这些 */
export const baselineLanguageIds = ['java', 'javascript', 'python'] as const
/** 首访时对比列默认选中的语言。必须已启用且 ≠ 默认基准 */
export const defaultCompareLanguageId = 'python' as const
/** 默认对比语言的显示名 —— 供静态文案使用，免去每处再查一次 meta */
export const defaultCompareLanguageName = 'Python' as const

export const siteInfo = {
  name: '编程语言对照手册',
  shortDescription: '选一门基准语言，逐板块对照目标语言的基础语法、迁移教程、迁移陷阱、速语词典与学习路线。默认以 JavaScript 为基准。',
  lang: 'zh-CN',
} as const

export const languageMeta: LanguageMeta[] = [
  {
    "id": "arkts",
    "name": "ArkTS",
    "shortName": "ArkTS",
    "aliases": [
      "arkts",
      "harmonyos",
      "harmony",
      "ets"
    ],
    "version": "API 12 (HarmonyOS NEXT)",
    "fileExtension": ".ets",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "typescript",
    "paradigm": [
      "oop",
      "declarative-ui",
      "static-typing"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "gc",
    "concurrency": [
      "single-threaded-ui",
      "taskpool",
      "worker"
    ],
    "baseline": false,
    "links": [
      {
        "label": "ArkTS 语言基础（HarmonyOS 开发者文档）",
        "url": "https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-basic-syntax-overview"
      }
    ],
    "metadata": {
      "runtime": "HarmonyOS ArkUI（非浏览器 / 非 Node）",
      "supersetOf": "TypeScript",
      "compiler": "ArkTS Compiler（非 tsc）",
      "packageManager": "ohpm（非 npm）",
      "stateManagement": "@State / @Prop / @Link 等装饰器",
      "restrictions": "禁用 any、结构化类型、动态属性、原型改写等 TS 特性"
    }
  },
  {
    "id": "dart",
    "name": "Dart",
    "shortName": "Dart",
    "aliases": [
      "flutter-dart"
    ],
    "version": "3.6",
    "fileExtension": ".dart",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "dart",
    "paradigm": [
      "oop",
      "functional",
      "multi-paradigm"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "gc",
    "concurrency": [
      "event-loop",
      "isolate",
      "async-await"
    ],
    "baseline": false,
    "links": [
      {
        "label": "Dart 官方语言之旅",
        "url": "https://dart.dev/language"
      }
    ]
  },
  {
    "id": "go",
    "name": "Go",
    "shortName": "Go",
    "aliases": [
      "golang"
    ],
    "version": "1.23",
    "fileExtension": ".go",
    "comment": {
      "line": "//"
    },
    "shikiLang": "go",
    "paradigm": [
      "imperative",
      "concurrent"
    ],
    "typing": "static",
    "typeSystem": "structural",
    "memoryModel": "gc",
    "concurrency": [
      "goroutine",
      "channel",
      "select"
    ],
    "baseline": false,
    "links": [
      {
        "label": "Go 官方教程（Tour of Go）",
        "url": "https://go.dev/tour/"
      },
      {
        "label": "Effective Go",
        "url": "https://go.dev/doc/effective_go"
      }
    ]
  },
  {
    "id": "java",
    "name": "Java",
    "shortName": "Java",
    "aliases": [
      "jdk",
      "jvm",
      "java21"
    ],
    "version": "21",
    "fileExtension": ".java",
    "comment": {
      "line": "//"
    },
    "shikiLang": "java",
    "paradigm": [
      "oop",
      "multi-paradigm"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "gc",
    "concurrency": [
      "threads",
      "virtual-threads",
      "executors"
    ],
    "baseline": true,
    "links": [
      {
        "label": "dev.java 官方学习站",
        "url": "https://dev.java/learn/"
      },
      {
        "label": "Java 语言规范（JLS SE 21）",
        "url": "https://docs.oracle.com/javase/specs/jls/se21/html/index.html"
      }
    ]
  },
  {
    "id": "javascript",
    "name": "JavaScript",
    "shortName": "JS",
    "aliases": [
      "js",
      "ecmascript",
      "es"
    ],
    "version": "ES2024",
    "fileExtension": ".js",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "javascript",
    "paradigm": [
      "multi-paradigm",
      "prototype-based",
      "functional"
    ],
    "typing": "dynamic",
    "memoryModel": "gc",
    "concurrency": [
      "event-loop",
      "promise",
      "async-await",
      "worker"
    ],
    "baseline": true,
    "links": [
      {
        "label": "MDN JavaScript 指南",
        "url": "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript"
      },
      {
        "label": "ECMAScript 语言规范",
        "url": "https://tc39.es/ecma262/"
      }
    ]
  },
  {
    "id": "kotlin",
    "name": "Kotlin",
    "shortName": "Kt",
    "aliases": [
      "kt",
      "kotlin-jvm"
    ],
    "version": "2.1",
    "fileExtension": ".kt",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "kotlin",
    "paradigm": [
      "oop",
      "functional",
      "multi-paradigm"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "gc",
    "concurrency": [
      "coroutines",
      "threads",
      "flows"
    ],
    "baseline": false,
    "links": [
      {
        "label": "Kotlin 官方文档",
        "url": "https://kotlinlang.org/docs/home.html"
      }
    ]
  },
  {
    "id": "python",
    "name": "Python",
    "shortName": "Py",
    "aliases": [
      "py",
      "python3",
      "cpython"
    ],
    "version": "3.13",
    "fileExtension": ".py",
    "comment": {
      "line": "#"
    },
    "shikiLang": "python",
    "paradigm": [
      "multi-paradigm",
      "oop",
      "functional"
    ],
    "typing": "gradual",
    "typeSystem": "nominal",
    "memoryModel": "gc",
    "concurrency": [
      "threading",
      "multiprocessing",
      "asyncio",
      "gil"
    ],
    "baseline": true,
    "links": [
      {
        "label": "Python 官方教程",
        "url": "https://docs.python.org/3/tutorial/"
      },
      {
        "label": "PEP 8 风格指南",
        "url": "https://peps.python.org/pep-0008/"
      }
    ]
  },
  {
    "id": "rust",
    "name": "Rust",
    "shortName": "Rust",
    "aliases": [
      "rs",
      "rustlang"
    ],
    "version": "1.83",
    "fileExtension": ".rs",
    "comment": {
      "line": "//"
    },
    "shikiLang": "rust",
    "paradigm": [
      "multi-paradigm",
      "functional",
      "imperative"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "manual",
    "concurrency": [
      "threads",
      "async-await",
      "channels"
    ],
    "baseline": false,
    "links": [
      {
        "label": "The Rust Programming Language（the book）",
        "url": "https://doc.rust-lang.org/book/"
      },
      {
        "label": "Rust 标准库文档",
        "url": "https://doc.rust-lang.org/std/"
      }
    ]
  },
  {
    "id": "swift",
    "name": "Swift",
    "shortName": "Swift",
    "aliases": [
      "swift5",
      "swiftui"
    ],
    "version": "6.0",
    "fileExtension": ".swift",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "swift",
    "paradigm": [
      "oop",
      "functional",
      "protocol-oriented"
    ],
    "typing": "static",
    "typeSystem": "nominal",
    "memoryModel": "arc",
    "concurrency": [
      "async-await",
      "actor",
      "structured-concurrency"
    ],
    "baseline": false,
    "links": [
      {
        "label": "The Swift Programming Language",
        "url": "https://docs.swift.org/swift-book/documentation/the-swift-programming-language/"
      }
    ]
  },
  {
    "id": "typescript",
    "name": "TypeScript",
    "shortName": "TS",
    "aliases": [
      "ts"
    ],
    "version": "5.9",
    "fileExtension": ".ts",
    "comment": {
      "line": "//",
      "block": [
        "/*",
        "*/"
      ]
    },
    "shikiLang": "typescript",
    "paradigm": [
      "multi-paradigm",
      "oop",
      "functional"
    ],
    "typing": "static",
    "typeSystem": "structural",
    "memoryModel": "gc",
    "concurrency": [
      "event-loop",
      "promise",
      "async-await",
      "worker"
    ],
    "baseline": false,
    "links": [
      {
        "label": "TypeScript 官方手册",
        "url": "https://www.typescriptlang.org/docs/handbook/intro.html"
      }
    ]
  }
]

export const enabledLanguageMeta = languageMeta.filter((m): m is LanguageMeta =>
  (enabledLanguageIds as readonly string[]).includes(m.id),
)

export function getLanguageMeta(id: string): LanguageMeta | undefined {
  return languageMeta.find((m) => m.id === id)
}

export const isLanguageEnabled = (id: string): boolean =>
  (enabledLanguageIds as readonly string[]).includes(id)
