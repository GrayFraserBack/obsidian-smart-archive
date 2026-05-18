import { SmartArchiveSettings } from "./settings";
import { TreeNode, treeToText, getAllFolderPaths } from "./vault-tree";
import { MarkdownHeading, TitleFormatIssue, TitleReview } from "./title-audit";

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
  summary: string;
  directories: DirectoryRec[];
  filenames: FilenameRec[];
  titleReviews: TitleReview[];
  formatIssues: TitleFormatIssue[];
}

// ── Prompt 构建 ───────────────────────────────────────────
function buildMessages(
  settings: SmartArchiveSettings,
  vaultTree: TreeNode[],
  content: string,
  currentPath: string,
  extraContext: string,
  headings: MarkdownHeading[]
) {
  const allFolders       = getAllFolderPaths(vaultTree);
  const fullTree         = treeToText(vaultTree);
  const truncatedContent = content.slice(0, settings.maxContentLength);
  const count            = settings.recommendCount;
  const headingList      = headings.map((heading) => ({
    id: heading.id,
    path: heading.path,
    line: heading.line,
    level: heading.level,
    title: heading.title,
    hasAsciiSymbol: heading.hasAsciiSymbol,
    missingBacktickWords: heading.missingBacktickWords,
  }));

  const systemPrompt = `你是一个 Obsidian 笔记归档与标题优化助手。必须只输出一个合法 JSON 对象，不要输出 Markdown、解释、代码块或 JSON 以外的任何字符。

JSON 结构：
{
  "summary": "用 2-3 句分析笔记主题和推荐归档方向",
  "directories": [
    { "path": "目录路径", "reason": "简短理由（≤15字）", "isNew": false }
  ],
  "filenames": [
    { "name": "文件名（不含.md）", "reason": "简短理由（≤15字）" }
  ],
  "titleReviews": [
    {
      "path": "文件路径",
      "line": 1,
      "level": 1,
      "currentTitle": "原标题",
      "isSuitable": false,
      "recommendedTitle": "建议标题",
      "reason": "简短原因"
    }
  ],
  "formatIssues": [
    {
      "path": "文件路径",
      "line": 1,
      "level": 1,
      "currentTitle": "原标题",
      "issue": "问题描述",
      "fixedTitle": "修正标题"
    }
  ]
}

规则：
- 精确推荐 ${count} 个目录和 ${count} 个文件名
- 优先使用已有目录列表中的路径；不合适时可新建（isNew: true）
- 文件名风格与现有文件保持一致
- 标题中任何英文单词都必须用反引号包裹，例如「学习 \`React\` Hooks」，不要写成「学习 React Hooks」
- recommendedTitle 和 fixedTitle 中的英文单词也必须用反引号包裹
- 技术术语必须使用官方/行业标准大小写，例如 \`ConfigMap\`、\`Secret\`、\`JavaScript\`、\`TypeScript\`、\`OpenAI\`；禁止把 \`ConfigMap\` 改成 \`Configmap\`
- 如果原文技术词大小写不标准，建议改为标准写法；如果原文大小写已标准，只允许添加反引号，不要改变大小写
- 同一个 path+line 标题只能出现在 titleReviews 或 formatIssues 其中一个数组里，不能重复
- 标题没问题就不要返回；有问题时只给 1 个最终建议
- 所有字符串必须正确 JSON 转义，禁止尾随逗号`;

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
${truncatedContent}

=== 当前文件 H1-H3 标题 ===
${JSON.stringify(headingList)}`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt   },
  ];
}

// ── 解析 JSON ────────────────────────────────────────────
function parseRecommendation(fullText: string): AIRecommendation {
  const start = fullText.indexOf("---JSON_START---");
  const end   = fullText.indexOf("---JSON_END---");

  const jsonRaw = (start === -1
    ? fullText
    : fullText.slice(start + "---JSON_START---".length, end === -1 ? undefined : end))
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
  parsed.summary = typeof parsed.summary === "string" ? parsed.summary : "";
  parsed.titleReviews = Array.isArray(parsed.titleReviews) ? parsed.titleReviews : [];
  parsed.formatIssues = Array.isArray(parsed.formatIssues) ? parsed.formatIssues : [];

  return parsed;
}

// ── 流式调用 ─────────────────────────────────────────────
export async function analyzeStream(
  settings: SmartArchiveSettings,
  vaultTree: TreeNode[],
  content: string,
  currentPath: string,
  extraContext: string,
  headings: MarkdownHeading[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<AIRecommendation> {
  const messages = buildMessages(settings, vaultTree, content, currentPath, extraContext, headings);
  const requestBody = {
    model: settings.model,
    messages,
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    stream: true,
  };

  let response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    if (
      response.status === 400 &&
      /response_format|json_object/i.test(errText)
    ) {
      const fallbackBody = { ...requestBody, response_format: undefined };
      response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(fallbackBody),
        signal,
      });
      if (response.ok) {
        return readRecommendationStream(response, onChunk, signal);
      }
      const fallbackErr = await response.text();
      throw new Error(`API 请求失败 (${response.status})：${fallbackErr.slice(0, 200)}`);
    }
    throw new Error(`API 请求失败 (${response.status})：${errText.slice(0, 200)}`);
  }

  return readRecommendationStream(response, onChunk, signal);
}

async function readRecommendationStream(
  response: Response,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<AIRecommendation> {
  if (!response.body) throw new Error("响应体为空，不支持流式输出");

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();

  let accumulated = "";
  let sseBuffer   = "";

  const handlePayload = (payload: string) => {
    if (payload === "[DONE]") return;

    let delta = "";
    try { delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? ""; }
    catch { return; }
    if (!delta) return;

    accumulated += delta;
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

  const rec = parseRecommendation(accumulated);
  if (rec.summary) onChunk(rec.summary);
  return rec;
}
