# Obsidian Smart Archive

Obsidian Smart Archive 是一个基于 OpenAI 兼容接口的单文件智能归档插件。它会读取当前 Vault 的目录结构和当前笔记内容，推荐更合适的归档目录和文件名，并提供一键移动、重命名能力。

![GrayFraserGit|1000](https://gray-image-hub.oss-cn-beijing.aliyuncs.com/20260101/002a1a5097244b3eb9534d4269660453.png)

## 功能

- 智能分析当前笔记，推荐归档目录和文件名。
- 支持右键分析单个文件。
- 支持在侧边栏查看 AI 流式分析过程。
- 分析中可暂停当前请求，并保留已输出内容。
- 暂停按钮会显示当前接口耗时，精确到毫秒。
- 支持补充说明，让 AI 结合额外背景生成更准确建议。
- 支持复制推荐路径或文件名。
- 支持一键移动文件、重命名文件。
- 移动或重命名前会弹出确认窗口。
- 支持自动分析打开的笔记，设置开关即时生效。

## AI 能力

插件会把以下信息发送给配置的 AI 接口：

- 当前分析对象的路径。
- 当前 Vault 的完整目录列表。
- 当前 Vault 的树形结构。
- 当前笔记内容。
- 用户填写的补充说明。

AI 返回结果会被解析为结构化数据，用于渲染推荐卡片和执行操作。

流式输出会按小批量刷新，避免每个 token 都触发布局；SSE 半行数据会被缓存后继续解析，减少因分片导致的 JSON 解析失败。

## 设置项

在 Obsidian 设置页中打开「智能归档」后可配置：

- `Base URL`：OpenAI 兼容接口地址，默认 `https://api.openai.com/v1`。
- `API Key`：对应服务的密钥。
- `模型名称`：使用的模型 ID，例如 `gpt-4o`、`deepseek-chat` 等。
- `自动分析`：打开笔记时自动触发分析，开关即时生效。
- `推荐数量`：每次推荐的目录和文件名数量，范围 1-5。
- `最大发送字数`：单次发送给 AI 的笔记内容最大字符数。

设置页提供连接测试按钮，可验证接口配置是否可用。

## 使用方式

1. 在设置中填写 `Base URL`、`API Key` 和模型名称。
2. 点击左侧 Ribbon 的归档图标，打开智能归档侧边栏。
3. 打开一篇笔记，或在文件列表中右键选择单个文件进行分析。
4. 查看 AI 推荐结果。
5. 分析过程中可点击暂停按钮中断请求，按钮会显示当前接口耗时。
6. 根据需要执行移动、重命名或复制路径。

## 下载安装

本仓库会提交 `dist/` 构建产物，普通用户不需要本地编译即可安装。

下载以下文件：

- `dist/main.js`
- `dist/manifest.json`
- `dist/styles.css`

将它们放入 Obsidian Vault 的插件目录：

```text
.obsidian/plugins/obsidian-smart-archive/
```

然后在 Obsidian 设置中启用第三方插件，并启用「Smart Archive」。

## 开发

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm.cmd run build
```

构建产物会输出到 `dist/`，包括：

- `main.js`
- `manifest.json`
- `styles.css`

`dist/` 会随仓库一起提交，便于用户直接下载安装。

## 项目结构

```text
src/
  ai-client.ts             AI 请求、流式解析、推荐结果解析
  confirm-modal.ts         通用确认弹窗
  main.ts                  插件入口、命令和视图注册
  settings.ts              插件设置页
  sidebar-view.ts          智能归档侧边栏
  styles.css               插件样式
  vault-tree.ts            Vault 树结构构建工具
```

## 注意事项

- 插件会读取笔记内容并发送给配置的 AI 服务，请确认服务和密钥来源可信。
- 执行移动、重命名会修改 Vault 文件结构，请在确认弹窗中核对路径。
