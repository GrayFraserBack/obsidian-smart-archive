import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type SmartArchivePlugin from "./main";

export interface SmartArchiveSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  autoAnalyze: boolean;
  maxContentLength: number;
  recommendCount: number;
}

export const DEFAULT_SETTINGS: SmartArchiveSettings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  autoAnalyze: false,
  maxContentLength: 8000,
  recommendCount: 3,
};

export class SmartArchiveSettingTab extends PluginSettingTab {
  plugin: SmartArchivePlugin;

  constructor(app: App, plugin: SmartArchivePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "智能归档 — 设置" });

    // ── AI 接口配置 ──────────────────────────────────────────
    containerEl.createEl("h3", { text: "AI 接口配置" });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("OpenAI 兼容接口地址，可填 Claude、DeepSeek、本地模型等任意兼容服务")
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value.replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("对应服务的 API Key")
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("模型名称")
      .setDesc("使用的模型 ID，例如 gpt-4o、deepseek-chat、claude-sonnet-4-6 等")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4o")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("验证 API 配置是否正确")
      .addButton((btn) =>
        btn.setButtonText("测试").onClick(async () => {
          btn.setButtonText("测试中...");
          btn.setDisabled(true);
          try {
            const res = await fetch(
              `${this.plugin.settings.baseUrl}/chat/completions`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.plugin.settings.apiKey}`,
                },
                body: JSON.stringify({
                  model: this.plugin.settings.model,
                  messages: [{ role: "user", content: "reply OK" }],
                  max_tokens: 5,
                }),
              }
            );
            if (res.ok) {
              new Notice("✅ 连接成功！");
            } else {
              const err = await res.text();
              new Notice(`❌ 连接失败：${res.status} ${err.slice(0, 100)}`);
            }
          } catch (e: any) {
            new Notice(`❌ 连接失败：${e.message}`);
          } finally {
            btn.setButtonText("测试");
            btn.setDisabled(false);
          }
        })
      );

    // ── 分析行为 ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "分析行为" });

    new Setting(containerEl)
      .setName("自动分析")
      .setDesc("打开笔记时自动触发智能归档分析")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoAnalyze).onChange(async (value) => {
          this.plugin.settings.autoAnalyze = value;
          await this.plugin.saveSettings();
          new Notice(value ? "已开启自动分析" : "已关闭自动分析");
        })
      );

    new Setting(containerEl)
      .setName("推荐数量")
      .setDesc("每次推荐的目录和文件名数量（1–5）")
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.recommendCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.recommendCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("最大发送字数")
      .setDesc("发送给 AI 的笔记内容最大字符数，过大会增加 token 消耗")
      .addText((text) =>
        text
          .setPlaceholder("8000")
          .setValue(String(this.plugin.settings.maxContentLength))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxContentLength = num;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
