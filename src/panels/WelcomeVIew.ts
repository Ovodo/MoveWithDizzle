import * as vscode from "vscode";

export class WelcomeView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.welcome";
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "startContract") {
        vscode.commands.executeCommand("movewithdizzle.startContract"); // Send command to extension.ts
      }
    });
  }

  private getWebviewContent(): string {
    return `
  <html>
  <body>
    <h1>Welcome to MoveWithDizzle</h1>
    <p>Start a new Move contract to begin.</p>
    <button id="startContract">Start a New Contract</button>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById("startContract").addEventListener("click", () => {
        vscode.postMessage({ command: "startContract" });
      });
    </script>
  </body>
  </html>
`;
  }
}
