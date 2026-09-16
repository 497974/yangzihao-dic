/**
 * 离线词表反查不到、但中文网页上很常见的合成词（中文网页混入英文词用）。
 *
 * ECDICT 是英译中词典，反查中文时只认得每个英文词的第一个义项：
 * 「留学生」「交换生」「人工智能」这类合成词在里面找不到对应的英文。
 * 这里补上一批新闻、教育、科技类文章里高频出现的，难度档按英文说法的难度人工标注
 * （1 中考 … 7 GRE，和词表一致）。
 */

export interface ChineseCompound {
  zh: string
  en: string
  level: number
}

export const CHINESE_COMPOUNDS: readonly ChineseCompound[] = [
  // 教育
  { zh: "留学生", en: "international student", level: 3 },
  { zh: "交换生", en: "exchange student", level: 3 },
  { zh: "大学生", en: "college student", level: 2 },
  { zh: "研究生", en: "postgraduate", level: 4 },
  { zh: "本科生", en: "undergraduate", level: 4 },
  { zh: "毕业生", en: "graduate", level: 3 },
  { zh: "博士生", en: "doctoral student", level: 5 },
  { zh: "实习生", en: "intern", level: 4 },
  { zh: "奖学金", en: "scholarship", level: 4 },
  { zh: "志愿者", en: "volunteer", level: 3 },
  // 科技
  { zh: "人工智能", en: "artificial intelligence", level: 4 },
  { zh: "社交媒体", en: "social media", level: 4 },
  { zh: "电子商务", en: "e-commerce", level: 5 },
  { zh: "数字化", en: "digitalization", level: 6 },
  { zh: "基础设施", en: "infrastructure", level: 6 },
  { zh: "供应链", en: "supply chain", level: 5 },
  { zh: "远程办公", en: "remote work", level: 4 },
  // 环境、经济、社会
  { zh: "气候变化", en: "climate change", level: 4 },
  { zh: "可持续发展", en: "sustainable development", level: 5 },
  { zh: "可持续", en: "sustainable", level: 5 },
  { zh: "新能源", en: "renewable energy", level: 5 },
  { zh: "碳排放", en: "carbon emissions", level: 6 },
  { zh: "全球化", en: "globalization", level: 5 },
  { zh: "经济增长", en: "economic growth", level: 4 },
  { zh: "通货膨胀", en: "inflation", level: 5 },
  { zh: "心理健康", en: "mental health", level: 4 },
  { zh: "雄心勃勃", en: "ambitious", level: 4 },
  { zh: "创业", en: "entrepreneurship", level: 6 },
  // 校正：自动反查挑出来的词意思不对的常用词。有人工对照的中文词只用这里的说法
  { zh: "交换", en: "exchange", level: 2 },
  { zh: "进展", en: "progress", level: 2 },
  { zh: "学生", en: "student", level: 1 },
  { zh: "时间", en: "time", level: 1 },
]
