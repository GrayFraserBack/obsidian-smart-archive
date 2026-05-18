import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type SmartArchivePlugin from "./main";
import { buildVaultTree } from "./vault-tree";
import { analyzeStream, AIRecommendation, DirectoryRec, FilenameRec } from "./ai-client";
import { ConfirmModal } from "./confirm-modal";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;

export const SIDEBAR_VIEW_TYPE = "smart-archive-sidebar";

export class SidebarView extends ItemView {
  plugin: SmartArchivePlugin;

  private currentTarget: TFile | null = null;
  private targetInfoEl!: HTMLElement;
  private extraInputEl!: HTMLTextAreaElement;
  private analyzeBtn!: HTMLButtonElement;
  private streamBoxEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private abortController: AbortController | null = null;
  private requestStartedAt = 0;
  private requestTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SmartArchivePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType()    { return SIDEBAR_VIEW_TYPE; }
  getDisplayText() { return "智能归档"; }
  getIcon()        { return "archive"; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("sa-sidebar");

    root.createEl("div", { cls: "sa-sidebar-header", text: "🗂 智能归档" });

    this.targetInfoEl = root.createDiv({ cls: "sa-target-info" });
    this.refreshTargetInfo();

    root.createEl("div", { cls: "sa-label", text: "补充说明（可选）" });
    this.extraInputEl = root.createEl("textarea", {
      cls: "sa-extra-input",
      attr: { placeholder: "输入额外背景信息，帮助 AI 更准确推荐..." },
    }) as HTMLTextAreaElement;

    this.analyzeBtn = root.createEl("button", {
      text: "🔍 分析",
      cls: "sa-analyze-btn",
    }) as HTMLButtonElement;
    this.analyzeBtn.addEventListener("click", () => {
      if (this.abortController) this.pauseAnalysis();
      else this.startAnalysis();
    });

    root.createEl("div", { cls: "sa-section-title", text: "AI 分析" });
    this.streamBoxEl = root.createDiv({ cls: "sa-stream-box" });
    this.actionsEl   = root.createDiv({ cls: "sa-actions-box" });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;

        this.currentTarget = file;
        this.refreshTargetInfo();

        if (this.abortController) {
          this.pauseAnalysis();
          this.streamBoxEl.createEl("p", {
            text: "已切换文件，请重新分析",
            cls: "sa-retry-notice",
          });
        }
      })
    );
  }

  setTarget(target: TFile) {
    this.currentTarget = target;
    this.refreshTargetInfo();
    this.startAnalysis();
  }

  private refreshTargetInfo() {
    this.targetInfoEl.empty();
    const target = this.currentTarget ?? this.app.workspace.getActiveFile();
    if (!target) {
      this.targetInfoEl.createEl("span", { text: "未选中任何文件", cls: "sa-muted" });
      return;
    }
    this.targetInfoEl.createEl("span", { text: "📄 " });
    this.targetInfoEl.createEl("code", { text: target.path, cls: "sa-target-path" });
  }

  // ══════════════════════════════════════════════════════════
  // 单文件分析（流式 + 重试）
  // ══════════════════════════════════════════════════════════
  async startAnalysis() {
    if (this.abortController) {
      this.pauseAnalysis();
      return;
    }

    const target = this.currentTarget ?? this.app.workspace.getActiveFile();

    if (!target) {
      new Notice("⚠️ 请先打开一个笔记，或通过右键菜单选择文件");
      return;
    }
    if (!this.plugin.settings.apiKey) {
      new Notice("⚠️ 请先在「智能归档」设置中填写 API Key");
      return;
    }

    this.streamBoxEl.empty();
    this.actionsEl.empty();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.setBusy(true);

    const extraContext = this.extraInputEl.value.trim();
    const vaultTree    = buildVaultTree(this.app);
    let content: string;

    try {
      content = await this.app.vault.read(target);
    } catch (e: any) {
      this.streamBoxEl.createEl("p", { text: `❌ 读取文件失败：${e.message}`, cls: "sa-error" });
      if (this.abortController === abortController) this.abortController = null;
      this.setBusy(false);
      return;
    }

    let lastError: Error | null = null;
    let paused = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        this.streamBoxEl.empty();
        const tip = this.streamBoxEl.createEl("p", {
          text: `⟳ JSON 格式有误，第 ${attempt}/${MAX_RETRIES} 次重试中...`,
          cls: "sa-retry-notice",
        });
        new Notice(`智能归档：第 ${attempt}/${MAX_RETRIES} 次重试...`);
        await sleep(600);
        tip.remove();
      }

      const cursor = this.streamBoxEl.createEl("span", { cls: "sa-cursor", text: "▌" });
      let pendingText = "";
      let flushTimer: number | null = null;
      let hasFlushed = false;
      const flushText = () => {
        flushTimer = null;
        if (!pendingText) {
          return;
        }
        cursor.insertAdjacentText("beforebegin", pendingText);
        pendingText = "";
        hasFlushed = true;
        this.streamBoxEl.scrollTop = this.streamBoxEl.scrollHeight;
      };
      const queueText = (chunk: string) => {
        pendingText += chunk;
        if (!hasFlushed) {
          flushText();
          return;
        }
        if (flushTimer === null) {
          flushTimer = window.setTimeout(flushText, 32);
        }
      };

      try {
        this.startRequestTimer();
        const rec = await analyzeStream(
          this.plugin.settings,
          vaultTree,
          content,
          target.path,
          extraContext,
          queueText,
          abortController.signal
        );

        this.stopRequestTimer();
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flushText();
        cursor.remove();
        this.renderActions(target, rec);
        if (this.abortController === abortController) this.abortController = null;
        this.setBusy(false);
        return;
      } catch (err: any) {
        this.stopRequestTimer();
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flushText();
        cursor.remove();

        if (abortController.signal.aborted || err?.name === "AbortError") {
          paused = true;
          break;
        }

        lastError = err;
        console.error(`[智能归档] 第 ${attempt} 次失败`, err);

        const isJsonError =
          err.message?.includes("JSON") ||
          err.message?.includes("分隔符") ||
          err.message?.includes("解析失败") ||
          err.message?.includes("格式");

        if (!isJsonError || attempt === MAX_RETRIES) break;
      }
    }

    if (paused) {
      this.streamBoxEl.createEl("p", { text: "已暂停分析", cls: "sa-retry-notice" });
      if (this.abortController === abortController) this.abortController = null;
      this.setBusy(false);
      return;
    }

    this.streamBoxEl.createEl("p", {
      text: `❌ 分析失败（已重试 ${MAX_RETRIES} 次）：${lastError?.message ?? "未知错误"}`,
      cls: "sa-error",
    });
    console.error("[智能归档] 全部重试失败", lastError);
    if (this.abortController === abortController) this.abortController = null;
    this.setBusy(false);
  }

  // ══════════════════════════════════════════════════════════
  // 渲染推荐操作区
  // ══════════════════════════════════════════════════════════
  private renderActions(target: TFile, recs: AIRecommendation) {
    const el = this.actionsEl;
    el.empty();

    el.createEl("div", { cls: "sa-section-title", text: "📁 推荐目录" });
    for (const dir of recs.directories) {
      this.renderDirCard(el, target, dir);
    }

    el.createEl("div", { cls: "sa-section-title", text: "📝 推荐文件名" });
    for (const fn of recs.filenames) {
      this.renderFnCard(el, target, fn);
    }
  }

  private renderDirCard(container: HTMLElement, target: TFile, dir: DirectoryRec) {
    const card = container.createDiv({ cls: "sa-rec-card" });
    const titleRow = card.createDiv({ cls: "sa-rec-title" });
    titleRow.createEl("span", { text: dir.path, cls: "sa-rec-path" });
    if (dir.isNew) titleRow.createEl("span", { text: "新建", cls: "sa-badge-new" });
    card.createEl("p", { text: dir.reason, cls: "sa-rec-reason" });

    const btns = card.createDiv({ cls: "sa-rec-btns" });
    btns
      .createEl("button", { text: "移动文件到此", cls: "sa-btn-primary" })
      .addEventListener("click", () => this.confirmMove(target, dir.path, dir.isNew));
    btns
      .createEl("button", { text: "复制路径", cls: "sa-btn-secondary" })
      .addEventListener("click", () => {
        navigator.clipboard.writeText(dir.path);
        new Notice(`已复制：${dir.path}`);
      });
  }

  private renderFnCard(container: HTMLElement, target: TFile, fn: FilenameRec) {
    const card = container.createDiv({ cls: "sa-rec-card" });
    card.createDiv({ cls: "sa-rec-title" })
      .createEl("span", { text: fn.name + ".md", cls: "sa-rec-path" });
    card.createEl("p", { text: fn.reason, cls: "sa-rec-reason" });

    const btns = card.createDiv({ cls: "sa-rec-btns" });
    btns
      .createEl("button", { text: "使用此文件名", cls: "sa-btn-primary" })
      .addEventListener("click", () => this.confirmRename(target, fn.name));
    btns
      .createEl("button", { text: "复制文件名", cls: "sa-btn-secondary" })
      .addEventListener("click", () => {
        navigator.clipboard.writeText(fn.name + ".md");
        new Notice(`已复制：${fn.name}.md`);
      });
  }

  private confirmMove(target: TFile, dirPath: string, isNew: boolean) {
    const lines = [
      `将把：  ${target.path}`,
      `移动到：${dirPath}/`,
      isNew ? "⚠️ 该目录不存在，将自动新建" : "",
    ].filter(Boolean).join("\n");

    new ConfirmModal(this.app, "确认移动", lines, async () => {
      try {
        if (isNew) {
          const exists = this.app.vault.getAbstractFileByPath(dirPath);
          if (!exists) await this.app.vault.createFolder(dirPath);
        }
        await this.app.fileManager.renameFile(target, `${dirPath}/${target.name}`);
        new Notice(`✅ 已移动到：${dirPath}/`);
        this.currentTarget = null;
        this.refreshTargetInfo();
      } catch (e: any) {
        new Notice(`❌ 移动失败：${e.message}`);
      }
    }).open();
  }

  private confirmRename(target: TFile, newBaseName: string) {
    const msg = `将把：${target.name}\n重命名为：${newBaseName}.md`;
    new ConfirmModal(this.app, "确认重命名", msg, async () => {
      try {
        const parent  = target.parent?.path ?? "";
        const newPath = parent ? `${parent}/${newBaseName}.md` : `${newBaseName}.md`;
        await this.app.fileManager.renameFile(target, newPath);
        new Notice(`✅ 已重命名为：${newBaseName}.md`);
      } catch (e: any) {
        new Notice(`❌ 重命名失败：${e.message}`);
      }
    }).open();
  }

  private setBusy(busy: boolean) {
    this.analyzeBtn.disabled    = false;
    this.analyzeBtn.textContent = busy ? this.getPauseLabel() : "🔍 分析";
  }

  private pauseAnalysis() {
    if (!this.abortController) return;
    this.analyzeBtn.disabled = true;
    this.analyzeBtn.textContent = "暂停中...";
    this.abortController.abort();
  }

  private startRequestTimer() {
    this.stopRequestTimer();
    this.requestStartedAt = Date.now();
    this.analyzeBtn.textContent = this.getPauseLabel();
    this.requestTimer = window.setInterval(() => {
      if (this.abortController && !this.analyzeBtn.disabled) {
        this.analyzeBtn.textContent = this.getPauseLabel();
      }
    }, 50);
  }

  private stopRequestTimer() {
    if (this.requestTimer !== null) {
      window.clearInterval(this.requestTimer);
      this.requestTimer = null;
    }
    this.requestStartedAt = 0;
    if (this.abortController && !this.analyzeBtn.disabled) {
      this.analyzeBtn.textContent = "暂停";
    }
  }

  private getPauseLabel() {
    if (!this.requestStartedAt) return "暂停";
    const elapsed = Date.now() - this.requestStartedAt;
    return `暂停 ${elapsed}ms`;
  }

  async onClose() { /* nothing */ }
}
