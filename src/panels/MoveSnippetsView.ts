import * as vscode from "vscode";

export class MoveSnippetsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.snippets";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getWebviewContent();
  }

  private getWebviewContent(): string {
    return `<html><body><h3>Snippets</h3><p>Quickly insert Move code snippets.</p></body></html>`;
  }
}
