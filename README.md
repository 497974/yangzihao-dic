# 大傻豪词典 · Yang Zihao Dic

完全本地化的浏览器翻译与语言学习插件。

用你自己的 AI API Key，**不需要注册账号，不上传云端，生词本没有数量上限**。

---

## 特性

| | |
|---|---|
| 🌐 沉浸式双语翻译 | 网页原文与译文并排显示 |
| 📖 划词词典 | 词条 / 音标 / 词性 / 释义 / 例句 / 例句翻译 / 难度 |
| 🎬 视频字幕翻译 | YouTube 双语字幕，带全片上下文感知 |
| 📓 本地生词本 | 存在浏览器里，**无数量上限**，可导出 CSV |
| 🔑 自带 API Key | 支持 OpenAI 兼容端点、通义千问、DeepSeek、Claude 等 |
| 🔒 零云端依赖 | 除了你自己配置的 AI 服务，不向任何服务器发请求 |

---

## 安装

1. 下载并解压本项目的 `chrome-mv3` 文件夹
2. 浏览器打开 `chrome://extensions/`
3. 右上角打开**开发者模式**
4. 点**加载已解压的扩展程序**，选中 `chrome-mv3` 文件夹

装好后点插件图标 → 设置 → **API 服务商**，填入你自己的 API Key 即可。

---

## 配 API Key

任选一家，填进设置里的「API 服务商」：

**阿里云百炼（推荐，有免费额度）**
```
类型:     OpenAI 兼容
Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
模型:     qwen3.8-flash
```
去 [百炼控制台](https://bailian.console.aliyun.com/) 创建 API Key。

**其他**：OpenAI、DeepSeek、Claude、硅基流动、OpenRouter 等都在设置里有内置选项。

> 填完记得点「测试连接」确认能通。

---

## 生词本

划词 → 词典 → **保存到笔记库**。

数据存在浏览器本地（`chrome.storage`），不上传任何服务器。
在设置里可以导出成 CSV。

**注意**：数据跟着浏览器配置文件走。换电脑或重装浏览器前记得先导出备份。

---

## 开发

```bash
pnpm install
pnpm dev          # 开发模式
pnpm build        # 构建产物到 .output/chrome-mv3
```

构建时环境变量要写在命令行里（`wxt.config.ts` 的构建期校验读 `process.env`）：

```bash
WXT_SKIP_ENV_VALIDATION=true pnpm build
```

---

## 授权

本项目以 **GPL-3.0** 发布，见 [LICENSE](LICENSE)。

基于开源项目 [Read Frog](https://github.com/mengxi-ream/read-frog) 修改而来，
修改内容见 [NOTICE](NOTICE)。
