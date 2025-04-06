import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class MoveAssistantView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.assistant";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview
    );
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "structs.html"
    );
    let html = fs.readFileSync(htmlPath, "utf8");

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, "src", "media", "style.css")
      )
    );

    // Inject the CSS link before </head>
    html = html.replace(
      "</head>",
      `<link rel="stylesheet" href="${styleUri}"/></head>`
    );

    return html;
  }
}
