import { Notice, Plugin, TFile } from "obsidian";
import {
  SmartArchiveSettings,
  DEFAULT_SETTINGS,
  SmartArchiveSettingTab,
} from "./settings";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./sidebar-view";

export default class SmartArchivePlugin extends Plugin {
  settings!: SmartArchiveSettings;

  async onload() {
    await this.loadSettings();

    // ── 注册侧边栏视图 ───────────────────────────────────────
    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new SidebarView(leaf, this));

    // ── 工具栏图标 ───────────────────────────────────────────
    this.addRibbonIcon("archive", "智能归档", () => this.openSidebar());

    // ── 命令面板 ────────────────────────────────────────────
    this.addCommand({
      id: "open-sidebar",
      name: "智能归档：打开侧边栏",
      callback: () => this.openSidebar(),
    });

    this.addCommand({
      id: "analyze-current-note",
      name: "智能归档：分析当前笔记",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("⚠️ 当前没有打开的笔记");
          return;
        }
        const view = await this.openSidebar();
        view?.setTarget(file);
      },
    });

    // ── 右键菜单（仅文件） ───────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (!(abstractFile instanceof TFile)) return;

        menu.addItem((item) => {
          item
            .setTitle("智能归档：分析此文件")
            .setIcon("archive")
            .onClick(async () => {
              const view = await this.openSidebar();
              view?.setTarget(abstractFile);
            });
        });

      })
    );

    // ── 自动分析（打开笔记时） ───────────────────────────────
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (!this.settings.autoAnalyze || !(file instanceof TFile)) return;
        setTimeout(async () => {
          if (!this.settings.autoAnalyze) return;
          const view = await this.openSidebar();
          view?.setTarget(file);
        }, 500);
      })
    );

    // ── 设置面板 ────────────────────────────────────────────
    this.addSettingTab(new SmartArchiveSettingTab(this.app, this));

    console.log("智能归档插件已加载");
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);
  }

  async openSidebar(): Promise<SidebarView | null> {
    const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);

    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    }

    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (leaves.length === 0) return null;

    this.app.workspace.revealLeaf(leaves[0]);
    return leaves[0].view as SidebarView;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
