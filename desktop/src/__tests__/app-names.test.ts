import { describe, expect, it } from "vitest"
import { friendlyAppName } from "../app-names"

describe("来源程序的名字", () => {
  it.each([
    ["C:\\Program Files\\Tencent\\QQNT\\QQ.exe", "QQ"],
    ["C:\\Program Files\\Tencent\\Weixin\\Weixin.exe", "微信"],
    ["C:\\Windows\\System32\\notepad.exe", "记事本"],
    ["C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE", "Word"],
    ["D:\\Tools\\MyReader.exe", "MyReader"],
  ])("%s → %s", (path, name) => {
    expect(friendlyAppName(path)).toBe(name)
  })

  it("拿不到路径就是 null", () => {
    expect(friendlyAppName(null)).toBeNull()
    expect(friendlyAppName("")).toBeNull()
  })
})
