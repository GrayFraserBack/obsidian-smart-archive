import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
  private title: string;
  private message: string;
  private onConfirm: () => Promise<void>;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => Promise<void>
  ) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sa-confirm-modal");

    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("pre", { text: this.message, cls: "sa-confirm-message" });

    const btnRow = contentEl.createDiv({ cls: "sa-confirm-buttons" });

    btnRow
      .createEl("button", { text: "确认", cls: "sa-btn-primary" })
      .addEventListener("click", async () => {
        this.close();
        await this.onConfirm();
      });

    btnRow
      .createEl("button", { text: "取消", cls: "sa-btn-secondary" })
      .addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
