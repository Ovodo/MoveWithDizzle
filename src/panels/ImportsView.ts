import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { normalizeAlias } from "../utils/helpers";
import { parseMoveFile } from "../utils/help";

export class ImportsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.imports";
  private _view?: vscode.WebviewView;
  private _imports: string[] = [];
  private _testImports: string[] = [];

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Listen for file save events
    vscode.workspace.onDidSaveTextDocument((document) => {
      console.log("File saved:", document.fileName);
      if (document === vscode.window.activeTextEditor?.document) {
        this.refreshView(); // Refresh when the active file is saved
      }
    });
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document) {
        console.log("Switched to file:", editor.document.fileName);
        this.refreshView(); // Refresh when a different file is focused
      }
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "src", "media")),
      ],
    };

    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );

    this.refreshView();

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "loadInitialImports":
            this.refreshView();
            return;
          case "addImport":
            if (message.test) {
              this._testImports.push(message.imports);
            } else {
              this._imports.push(message.imports);
            }
            await this.updateMoveFile(); // Wait for the file to update
            this.refreshView(); // Refresh the view after the file is updated
            return;
          case "deleteImport":
            if (message.test) {
              this._testImports = this._testImports.filter(
                (i) => i.replace(/\s+/g, " ").trim() !== message.importText,
              );
            } else {
              this._imports = this._imports.filter(
                (i) => i !== message.importText,
              );
            }
            await this.updateMoveFile(); // Wait for the file to update
            this.refreshView(); // Refresh the view after the file is updated
            return;
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  private async refreshView() {
    const { imports, testImports } = await parseMoveFile(this._context);
    this._imports = imports;
    this._testImports = testImports;
    this._view?.webview.postMessage({
      command: "updateImportList",
      imports: this._imports,
      testImports: this._testImports,
      dependencyModules: this.getDependencyModules(),
    });
  }

  private updateMoveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return Promise.resolve();
    }

    const doc = editor.document;
    const originalText = doc.getText();

    const regularImports = this._imports.map((i) => `\t${i}`).join("\n");
    const testImports = this._testImports.map((i) => `\t${i}`).join("\n");

    const allFormatted = [regularImports, testImports]
      .filter(Boolean)
      .join("\n\n");

    const moduleMatch = originalText.match(/module\s+[^\{]+\{/);
    if (!moduleMatch) {
      return Promise.resolve();
    }

    const moduleStartIndex = moduleMatch.index!;
    const insertIndex = originalText.indexOf("{", moduleStartIndex) + 1;

    const before = originalText.slice(0, insertIndex);
    const after = originalText.slice(insertIndex);

    // Remove old imports (including optional #[test_only]) near the start of the module body
    const afterCleaned = after.replace(
      /(\s*\n)*(#[^\n]+\n)?\s*use\s+.*?;\s*\n*/gm,
      "",
    );

    // Combine regular and test imports, and only add them once
    const newText = `${before}\n\n${allFormatted}\n${afterCleaned}`;

    return new Promise((resolve) => {
      editor
        .edit((editBuilder) => {
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(originalText.length),
          );
          editBuilder.replace(fullRange, newText);
        })
        .then(() => resolve());
    });
  }

  private getDependencyModules(): {
    label: string;
    description: string;
    icon: string;
  }[] {
    const workspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const buildPath = path.join(workspacePath, "build");
    const modules: { label: string; description: string; icon: string }[] = [];

    function walkDependencies(rootDir: string, prefix = "") {
      if (!fs.existsSync(rootDir)) {
        return;
      }

      const entries = fs.readdirSync(rootDir);
      for (const entry of entries) {
        const fullPath = path.join(rootDir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walkDependencies(fullPath, prefix ? `${prefix}::${entry}` : entry);
        } else if (entry.endsWith(".move")) {
          const moduleName = entry.replace(".move", "");
          const qualified = prefix ? `${prefix}::${moduleName}` : moduleName;
          const normalized = normalizeAlias(qualified);
          const root = normalized.split("::")[0];

          const icon = root === "sui" ? "🧩" : root === "std" ? "📦" : "📁";

          modules.push({
            label: normalized,
            description: `From ${root}`,
            icon,
          });
        }
      }
    }

    const moduleFolders = fs.readdirSync(buildPath);
    for (const moduleFolder of moduleFolders) {
      const dependenciesPath = path.join(
        buildPath,
        moduleFolder,
        "sources",
        "dependencies",
      );
      walkDependencies(dependenciesPath);
    }

    return modules;
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "imports.html",
    );
    let html = fs.readFileSync(htmlPath, "utf8");

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, "src", "media", "style.css"),
      ),
    );

    html = html.replace(
      "</head>",
      `<link rel="stylesheet" href="${styleUri}"/></head>`,
    );

    return html;
  }
}
