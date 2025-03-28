import * as vscode from "vscode";

export class MoveFunctionsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.functions";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getWebviewContent();
  }

  private getWebviewContent(): string {
    return `<html><body><h3>Functions</h3><p>Generate and manage Move functions.</p></body></html>`;
  }
}
