/**
 * 生成离线词表 public/data/wordlist.json（阶段五实现方案 · 步骤 0）。
 *
 * 数据源：ECDICT（https://github.com/skywind3000/ECDICT，MIT 授权）。
 * 原始 ecdict.csv 约 66 MB、76 万条，只取带考试标签的纯英文词条，
 * 每条留下「难度档、音标、简短释义」，再附上变形 → 原形的对照表。
 *
 * 用法：
 *   node scripts/build-wordlist.ts              没有缓存就先下载原始数据
 *   node scripts/build-wordlist.ts <ecdict.csv> 用本地已有的文件
 *
 * 原始数据缓存在 node_modules/.cache/ecdict/，不提交进仓库；生成的 wordlist.json 提交。
 */

import type { WordlistEntry, WordlistFile } from "../src/utils/wordlist/ecdict.ts"
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import {
  columnIndex,
  exchangeForms,
  harmonizeInflectionLevels,
  lemmaOf,
  LEVELS,
  parseCsvLine,
  toWordlistEntry,
} from "../src/utils/wordlist/ecdict.ts"
import { Wordlist } from "../src/utils/wordlist/lookup.ts"

const SOURCE_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
const CACHE_PATH = path.join("node_modules", ".cache", "ecdict", "ecdict.csv")
const OUTPUT_PATH = path.join("public", "data", "wordlist.json")

async function ensureSource(explicitPath: string | undefined): Promise<string> {
  if (explicitPath) {
    return explicitPath
  }
  if (existsSync(CACHE_PATH)) {
    return CACHE_PATH
  }
  console.log(`下载 ECDICT 原始数据（约 66 MB）：${SOURCE_URL}`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, Buffer.from(await response.arrayBuffer()))
  return CACHE_PATH
}

async function main() {
  const sourcePath = await ensureSource(process.argv[2])
  const lines = createInterface({
    input: createReadStream(sourcePath, "utf8"),
    crlfDelay: Infinity,
  })

  let columns: ReturnType<typeof columnIndex> | null = null
  let total = 0
  const entries = new Map<string, WordlistEntry>()
  const pendingForms = new Map<string, string>()
  /** 变形 → 原形，两个来源：原形行列出的变形，和变形行用 0: 指回的原形 */
  const inflectionLinks: Array<[string, string]> = []

  for await (const line of lines) {
    const fields = parseCsvLine(line)
    if (!columns) {
      columns = columnIndex(fields)
      continue
    }
    total++
    const row = {
      word: fields[columns.word] ?? "",
      phonetic: fields[columns.phonetic] ?? "",
      translation: fields[columns.translation] ?? "",
      tag: fields[columns.tag] ?? "",
      exchange: fields[columns.exchange] ?? "",
      frq: fields[columns.frq] ?? "",
      bnc: fields[columns.bnc] ?? "",
    }
    const pointsTo = lemmaOf(row.exchange)
    if (pointsTo) {
      inflectionLinks.push([row.word.trim().toLowerCase(), pointsTo])
    }
    const entry = toWordlistEntry(row)
    if (!entry) {
      continue
    }
    entries.set(entry[0], entry)
    for (const form of exchangeForms(row.exchange)) {
      inflectionLinks.push([form, entry[0]])
      if (!pendingForms.has(form)) {
        pendingForms.set(form, entry[0])
      }
    }
  }

  // countries、problems 这类变形在雅思托福词表里单独成条，档位不能比原形高（见 harmonizeInflectionLevels）
  const harmonized = harmonizeInflectionLevels(entries, inflectionLinks)

  const words = [...entries.values()].sort((a, b) => a[0].localeCompare(b[0]))

  // 变形表只存「后缀规则猜不出来」的：abandoning、studies 这类规则变化，
  // 运行时的查词逻辑本来就能还原成同一个原形，存进去白占体积。
  // 判断用的就是运行时同一个 Wordlist 类，保证删掉之后查出来的结果一模一样。
  // 变形词自己也是词表里的词时（leaves 既是 leaf 的复数也是 leave 的三单）按它自己的条目查，也不进变形表。
  const withoutForms = new Wordlist({ version: 1, source: "", levels: LEVELS, words, forms: {} })
  const forms: Record<string, string> = {}
  let regular = 0
  for (const [form, lemma] of pendingForms) {
    if (entries.has(form)) {
      continue
    }
    if (withoutForms.lookup(form)?.lemma === lemma) {
      regular++
      continue
    }
    forms[form] = lemma
  }
  const file: WordlistFile = {
    version: 1,
    source: "ECDICT (https://github.com/skywind3000/ECDICT), MIT License",
    levels: LEVELS,
    words,
    forms,
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(file))

  const perLevel = LEVELS.map((name, index) => {
    const count = words.filter((entry) => entry[1] === index + 1).length
    return `${name} ${count}`
  })
  const sizeKb = (statSync(OUTPUT_PATH).size / 1024).toFixed(0)
  console.log(
    `原始词条 ${total} 条 → 收录 ${words.length} 个词、${Object.keys(forms).length} 个不规则变形` +
      `（另有 ${regular} 个规则变形由后缀规则还原，不存）`,
  )
  console.log(`变形词条的档位按原形调低：${harmonized} 个`)
  console.log(`各档：${perLevel.join(" / ")}`)
  console.log(`已生成 ${OUTPUT_PATH}（${sizeKb} KB）`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
