import { SmartArchiveSettings } from "./settings";
import { TreeNode, treeToText, getAllFolderPaths } from "./vault-tree";

export interface DirectoryRec {
  path: string;
  reason: string;
  isNew: boolean;
}

export interface FilenameRec {
  name: string;
  reason: string;
}

export interface AIRecommendation {
  directories: DirectoryRec[];
  filenames: FilenameRec[];
}

// ── Prompt 构建 ───────────────────────────────────────────
function buildMessages(
  settings: SmartArchiveSettings,
  vaultTree: TreeNode[],
  content: string,
  currentPath: string,
  extraContext: string
) {
  const allFolders       = getAllFolderPaths(vaultTree);
  const fullTree         = treeToText(vaultTree);
  const truncatedContent = content.slice(0, settings.maxContentLength);
  const count            = settings.recommendCount;

  const systemPrompt = `你是一个 Obsidian 笔记归档助手。请完成两件事：

【第一步】用 2-3 句自然语言分析这篇笔记的主题和推荐归档方向。

【第二步】在下面两个分隔符之间输出 JSON 推荐数据（不要有其他内容）：
---JSON_START---
{
  "directories": [
    { "path": "目录路径", "reason": "简短理由（≤15字）", "isNew": false }
  ],
  "filenames": [
    { "name": "文件名（不含.md）", "reason": "简短理由（≤15字）" }
  ]
}
---JSON_END---

规则：
- 精确推荐 ${count} 个目录和 ${count} 个文件名
- 优先使用已有目录列表中的路径；不合适时可新建（isNew: true）
- 文件名风格与现有文件保持一致
- 只输出分析文字 + JSON 块，不要其他格式`;

  const folderList = allFolders.length > 0
    ? allFolders.join("\n")
    : "（Vault 根目录，暂无子目录）";

  const userPrompt = `当前文件：${currentPath}
${extraContext ? `\n补充说明：${extraContext}\n` : ""}
=== 全部目录列表（共 ${allFolders.length} 个，完整发送） ===
${folderList}

=== 完整 Vault 树形结构 ===
${fullTree}

=== 笔记内容（超长时截断，树结构不截断） ===
${truncatedContent}`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt   },
  ];
}

// ── 解析 JSON ────────────────────────────────────────────
function parseRecommendation(fullText: string): AIRecommendation {
  const start = fullText.indexOf("---JSON_START---");
  const end   = fullText.indexOf("---JSON_END---");

  if (start === -1) {
    throw new Error("AI 返回中未找到 JSON 分隔符，请检查模型或 Prompt");
  }

  const jsonRaw = fullText
    .slice(start + "---JSON_START---".length, end === -1 ? undefined : end)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: AIRecommendation;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    throw new Error(`JSON 解析失败：${jsonRaw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.directories) || !Array.isArray(parsed.filenames)) {
    throw new Error("AI 返回格式缺少 directories 或 filenames 字段");
  }

  return parsed;
}

// ── 流式调用 ─────────────────────────────────────────────
export async function analyzeStream(
  settings: SmartArchiveSettings,
  vaultTree: TreeNode[],
  content: string,
  currentPath: string,
  extraContext: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<AIRecommendation> {
  const messages = buildMessages(settings, vaultTree, content, currentPath, extraContext);

  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.3,
      max_tokens: 1200,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 请求失败 (${response.status})：${errText.slice(0, 200)}`);
  }
  if (!response.body) throw new Error("响应体为空，不支持流式输出");

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  const MARKER  = "---JSON_START---";

  let accumulated    = "";
  let visibleSent    = 0;
  let jsonStartFound = false;
  let sseBuffer      = "";

  const handlePayload = (payload: string) => {
    if (payload === "[DONE]") return;

    let delta = "";
    try { delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? ""; }
    catch { return; }
    if (!delta) return;

    accumulated += delta;

    if (jsonStartFound) return;

    const idx = accumulated.indexOf(MARKER);
    if (idx !== -1) {
      const remaining = accumulated.slice(visibleSent, idx);
      if (remaining) onChunk(remaining);
      jsonStartFound = true;
      return;
    }

    const safeEnd = Math.max(visibleSent, accumulated.length - MARKER.length);
    if (safeEnd > visibleSent) {
      onChunk(accumulated.slice(visibleSent, safeEnd));
      visibleSent = safeEnd;
    }
  };

  while (true) {
    if (signal?.aborted) throw new DOMException("分析已暂停", "AbortError");
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split(/\r?\n/);
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      handlePayload(trimmed.slice(5).trim());
    }
  }

  sseBuffer += decoder.decode();
  const leftover = sseBuffer.trim();
  if (leftover.startsWith("data:")) handlePayload(leftover.slice(5).trim());

  return parseRecommendation(accumulated);
}
