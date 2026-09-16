/** 记一次查词之后的结果（见 entrypoints/background/lookup-history.ts） */
export interface DictionaryLookupRecord {
  /** 算上这一次，这个词一共查了几次 */
  count: number
  /** 这个词已经在生词本里 */
  inNotebase: boolean
  /** 存过的词又查了一次，说明还没记住：它的复习卡被提前到了今天 */
  reviewBumped: boolean
}
