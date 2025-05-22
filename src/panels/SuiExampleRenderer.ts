import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Renderer for displaying Sui example file contents with syntax highlighting
 */
export class SuiExampleRenderer {
  /**
   * Creates a webview panel to display the contents of a Move file with syntax highlighting
   */
  public static renderMoveFile(
    context: vscode.ExtensionContext,
    filePath: string,
  ): void {
    const fileName = path.basename(filePath);
    const panel = vscode.window.createWebviewPanel(
      "suiExampleFile",
      `Example: ${fileName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media")),
        ],
      },
    );

    // Read file contents
    const fileContent = fs.readFileSync(filePath, "utf8");
    const fileExtension = path.extname(filePath).substring(1); // Remove the dot

    // Get webview html
    panel.webview.html = this.getWebviewContent(
      panel.webview,
      context,
      fileContent,
      fileExtension,
    );
  }

  /**
   * Generate HTML content for the webview
   */
  private static getWebviewContent(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    fileContent: string,
    fileExtension: string,
  ): string {
    // Get the local path to script and style for the webview
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, "src", "media", "style.css"),
      ),
    );

    // Escape the file content for HTML
    const escapedContent = this.escapeHtml(fileContent);

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${styleUri}">
            <title>Sui Example</title>
            <style>
                body {
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 10px;
                }
                pre {
                    padding: 10px;
                    white-space: pre-wrap;
                    overflow-x: auto;
                    background-color: var(--vscode-editor-background);
                    border-radius: 4px;
                }
                .code-container {
                    position: relative;
                }
                .language-tag {
                    position: absolute;
                    top: 5px;
                    right: 10px;
                    background-color: var(--vscode-activityBarBadge-background);
                    color: var(--vscode-activityBarBadge-foreground);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.8em;
                }
            </style>
        </head>
        <body>
            <div class="code-container">
                <span class="language-tag">${fileExtension}</span>
                <pre><code class="language-${fileExtension}">${escapedContent}</code></pre>
            </div>
        </body>
        </html>`;
  }

  /**
   * Escape HTML special characters
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
