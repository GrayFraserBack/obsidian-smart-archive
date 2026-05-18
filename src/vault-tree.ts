import { App, TFile, TFolder } from "obsidian";

export interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children?: TreeNode[];
}

const HIDDEN_NAMES = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".DS_Store",
  "node_modules",
  ".github",
  ".vscode",
]);

function isHidden(name: string): boolean {
  return name.startsWith(".") || HIDDEN_NAMES.has(name);
}

function buildTreeNodes(folder: TFolder): TreeNode[] {
  const nodes: TreeNode[] = [];
  const folders: TFolder[] = [];
  const files: TFile[] = [];

  for (const child of folder.children) {
    if (isHidden(child.name)) continue;
    if (child instanceof TFolder) {
      folders.push(child);
    } else if (child instanceof TFile) {
      files.push(child);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  for (const f of folders) {
    nodes.push({
      name: f.name,
      path: f.path,
      type: "folder",
      children: buildTreeNodes(f),
    });
  }

  for (const f of files) {
    nodes.push({
      name: f.name,
      path: f.path,
      type: "file",
    });
  }

  return nodes;
}

export function buildVaultTree(app: App): TreeNode[] {
  return buildTreeNodes(app.vault.getRoot());
}

export function treeToText(nodes: TreeNode[], indent = 0): string {
  let result = "";
  for (const node of nodes) {
    const prefix = "  ".repeat(indent);
    if (node.type === "folder") {
      result += `${prefix}[目录] ${node.path}/\n`;
      if (node.children && node.children.length > 0) {
        result += treeToText(node.children, indent + 1);
      }
    } else {
      result += `${prefix}${node.path}\n`;
    }
  }
  return result;
}

export function getAllFolderPaths(nodes: TreeNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      result.push(node.path);
      if (node.children) getAllFolderPaths(node.children, result);
    }
  }
  return result;
}
