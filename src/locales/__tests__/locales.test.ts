/**
 * 语言文件的静态检查。
 *
 * 为什么需要它：运行时的 i18n 在测试里是 mock 的（见 vitest.setup.ts），
 * 所以 yml 写坏了测试一个都不会红，只有 `pnpm build` 才会炸——
 * 实际就发生过一次：英文文案里写了 "as you read: mark ..."，
 * 冒号后面跟空格被 YAML 当成了嵌套的键，整个构建挂掉。
 *
 * 这里不引 YAML 解析器（项目里没有，为这点检查加一个依赖不划算），
 * 只静态查最容易踩的那几种写法。
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const LOCALES_DIR = join(import.meta.dirname, "..")
const FILES = readdirSync(LOCALES_DIR).filter((name) => name.endsWith(".yml"))

/** `  key: 值` 这样的一行 */
const ENTRY = /^(\s*)([A-Za-z0-9_]+):(?:\s(.*))?$/

interface Problem {
  file: string
  line: number
  text: string
  reason: string
}

function check(file: string): Problem[] {
  const problems: Problem[] = []
  const lines = readFileSync(join(LOCALES_DIR, file), "utf8").split("\n")

  lines.forEach((line, index) => {
    const report = (reason: string) =>
      problems.push({ file, line: index + 1, text: line.trim().slice(0, 60), reason })

    if (line.includes("\t")) {
      report("YAML 不允许用 Tab 缩进")
    }

    const match = ENTRY.exec(line)
    if (!match) {
      return
    }
    const [, indent = "", , rawValue] = match
    if (indent.length % 2 !== 0) {
      report("缩进不是 2 的倍数")
    }

    const value = rawValue?.trim()
    if (!value) {
      return
    }
    // 引号、块标量（| >）开头的值随便写；其余的值里出现「冒号 + 空格」会被当成嵌套的键
    if (!/^["'|>]/.test(value) && /:\s/.test(value)) {
      report("值里有「冒号 + 空格」，会被当成嵌套的键——把整个值用引号括起来")
    }
  })

  return problems
}

describe("语言文件", () => {
  it("有语言文件可查", () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it.each(FILES)("%s 没有会让构建失败的写法", (file) => {
    const problems = check(file)
    const report = problems.map((p) => `${p.file}:${p.line} ${p.reason}\n    ${p.text}`)

    expect(report).toEqual([])
  })
})
