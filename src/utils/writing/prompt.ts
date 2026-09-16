/**
 * 英文写作纠错（功能路线图阶段四第 4 条）的提示词。
 *
 * 复用划词自定义动作那一套结构化输出：拼一个「临时动作」交给后台
 * （见 utils/custom-action-execution.ts），供应商、参数、流式输出全都不用重写一遍。
 *
 * 为什么要「错误清单」这么一个用分隔符拼起来的字段：结构化输出只支持字符串和数字，
 * 给不了数组。所以让模型一行写一条、字段之间用 ||| 隔开，这边再拆成一条条错题
 * （见 parse.ts）。比让模型直接写一段散文好拆得多，也方便进错题本。
 */

import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { createOutputSchemaField } from "@/utils/constants/custom-action"

/** 一条错误里各段之间的分隔符 */
export const FIELD_SEPARATOR = "|||"

export const WRITING_FIELD = {
  corrected: "修改后",
  mistakes: "错误清单",
  comment: "总评",
} as const

/** 一次最多检查这么多字：再长一次调用会很贵，也容易超出模型的输出长度 */
export const MAX_WRITING_LENGTH = 2_000

const SYSTEM_PROMPT = `你是一位耐心的英语老师，学生的母语是中文。
你的任务是批改学生写的英文：改对，并且用中文讲清楚为什么。

批改原则：
1. 先保证正确（语法、时态、单复数、冠词、介词搭配、拼写），再让它自然。
2. 只改真正的问题。风格上的个人偏好不要动，别把学生的话改成你自己的说法。
3. 讲解一律用中文，讲"为什么错"和"什么时候该用哪个"，不要只说"应该这样写"。
4. 学生是中国人，常见的中式英语（时态不一致、冠词漏掉、名词单复数、
   "very like"、"open the light" 这类直译）要指出来，并说明中文是怎么带偏的。
5. 写得本来就对的地方，不要为了凑数硬挑错。全文没问题就把错误清单留空。`

/** 检查用的临时动作：名字、图标只是占位，这个动作不会存进配置，也不出现在划词工具栏 */
export function buildWritingCheckAction(providerId: string): SelectionToolbarCustomAction {
  return {
    id: "writing-check",
    name: "写作纠错",
    enabled: true,
    icon: "tabler:pencil-check",
    providerId,
    systemPrompt: SYSTEM_PROMPT,
    prompt: "",
    outputSchema: [
      createOutputSchemaField(
        WRITING_FIELD.corrected,
        "string",
        "改好之后的完整英文。只做必要的修改，保留学生原本的意思和语气。",
        "writing-corrected",
      ),
      createOutputSchemaField(
        WRITING_FIELD.mistakes,
        "string",
        [
          "逐条列出改动，一行一条，每行四段，段与段之间用 ||| 隔开：",
          "原文里错的片段 ||| 改成什么 ||| 错误类型 ||| 中文讲解",
          "错误类型只能是这几个之一：语法、时态、单复数、冠词、介词、搭配、用词、拼写、语序、更自然的说法。",
          "中文讲解一到两句，说清为什么错、什么时候该用哪个。",
          "不要加序号、不要加项目符号、不要写表头。没有可改的就返回空字符串。",
        ].join("\n"),
        "writing-mistakes",
      ),
      createOutputSchemaField(
        WRITING_FIELD.comment,
        "string",
        "一到两句中文总评：这次整体写得怎么样、最该先改掉的一个习惯是什么。",
        "writing-comment",
      ),
    ],
  }
}

/** 交给模型的正文 */
export function buildWritingPrompt(text: string): string {
  return `请批改下面这段英文：\n\n${text.trim()}`
}
