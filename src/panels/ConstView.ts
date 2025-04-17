import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MoveConstant, parseMoveFile } from "../utils/helpers";

export class ConstantsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.constants";
  private _view?: vscode.WebviewView;
  private _constants: MoveConstant[] = [];
  private _storageKey = "constants";

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved constants on initialization
    this.loadSavedConstants();

    // Listen for file save events
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document === vscode.window.activeTextEditor?.document) {
        this.refreshView(); // Refresh when the active file is saved
      }
    });

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document) {
        this.refreshView(); // Refresh when a different file is focused
      }
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (!currentFile) {
      webviewView.webview.html = "<h3>Please open a Move file first.</h3>";
      return;
    }

    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "src", "media")),
      ],
    };

    // Load existing constants from the file
    const { constants } = parseMoveFile();
    this._constants = constants;

    // Send extracted constants to the webview
    this.sendInitialConstants();

    // Set webview HTML with full constant creation interface
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );
    this.refreshView();

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "createConstant":
            this.createConstant(message.constant);
            return;
          case "editConstant":
            this.editConstant(message.constant, message.name);
            return;
          case "requestDeleteConstant":
            vscode.window
              .showWarningMessage(
                `Are you sure you want to delete constant "${message.constantName}"?`,
                { modal: true },
                "Delete",
              )
              .then((selection) => {
                if (selection === "Delete") {
                  this.deleteConstant(message.constantName);
                }
              });
            return;
          case "loadInitialConstants":
            this.sendInitialConstants();
            return;
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  private sendInitialConstants() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "initialConstants",
        constants: this._constants,
      });
      this._context.globalState.update("constants", this._constants);
    }
  }

  private refreshView() {
    const { constants } = parseMoveFile();
    this._constants = constants;
    this.sendInitialConstants();
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "constants.html",
    );
    let html = fs.readFileSync(htmlPath, "utf8");

    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(
        path.join(context.extensionPath, "src", "media", "style.css"),
      ),
    );

    // Inject the CSS link before </head>
    html = html.replace(
      "</head>",
      `<link rel="stylesheet" href="${styleUri}"/></head>`,
    );

    return html;
  }

  private updateMoveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return Promise.resolve();
    }

    const document = editor.document;
    let text = document.getText();

    // Step 1: Remove all existing constants
    text = text.replace(
      /const\s+\w+\s*:\s*\w+\s*=\s*[^;]*;/g, // Match all constants
      "",
    );

    // Step 2: Remove extra blank lines caused by deletion
    text = text.replace(/\n\s*\n/g, "\n").trim();

    // Step 3: Generate new constant declarations
    const constantDeclarations: string[] = [];
    const errorCodeDeclarations: string[] = [];

    this._constants.forEach((constant) => {
      const formattedValue = constant.value; // Constants are numbers in Move
      const newConstantText = `\tconst ${constant.name}: ${constant.type} = ${formattedValue};`; // Use constant.type for the type

      // Separate constants into general constants and error codes
      if (constant.name.startsWith("E")) {
        errorCodeDeclarations.push(newConstantText);
      } else {
        constantDeclarations.push(newConstantText);
      }
    });

    // Step 4: Create the formatted sections with /**/ comments
    const constantsSection = `
  \t/*==============================================================================================
  \t  Constants - Add your constants here (if any)
  \t==============================================================================================*/
  
  ${constantDeclarations.join("\n")}
  
  \t/*==============================================================================================
  \t  Error codes - DO NOT MODIFY
  \t==============================================================================================*/
  
  ${errorCodeDeclarations.join("\n")}
  `;

    // Step 5: Append new constants after the module imports and test imports
    if (constantDeclarations.length > 0 || errorCodeDeclarations.length > 0) {
      const importMatch = text.match(/(#[^\n]*\n\s*)?use\s+[^;]+;/g);
      if (importMatch) {
        const lastImportIndex =
          text.lastIndexOf(importMatch[importMatch.length - 1]) +
          importMatch[importMatch.length - 1].length;
        text =
          text.slice(0, lastImportIndex) +
          `\n\n${constantsSection}\n\n` +
          text.slice(lastImportIndex);
      } else {
        // If no imports are found, add constants at the beginning of the module body
        const moduleMatch = text.match(/module\s+[\w:]+\s*\{/);
        if (moduleMatch) {
          const insertPosition = text.indexOf("{", moduleMatch.index) + 1;
          text =
            text.slice(0, insertPosition) +
            `\n\n${constantsSection}\n\n` +
            text.slice(insertPosition);
        } else {
          // If no module declaration found, add at the beginning
          text = `${constantsSection}\n\n${text}`;
        }
      }
    }

    // Apply changes to the editor
    return new Promise((resolve) => {
      editor
        .edit((editBuilder) => {
          const all = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          );
          editBuilder.replace(all, text);
        })
        .then(() => {
          this.refreshView(); // Refresh constants from the file after updating
          resolve();
        });
    });
  }

  private createConstant(constant: MoveConstant) {
    const existingConstantIndex = this._constants.findIndex(
      (c) => c.name === constant.name,
    );

    if (existingConstantIndex !== -1) {
      this._constants[existingConstantIndex] = constant;
    } else {
      this._constants.push(constant);
    }

    this.updateMoveFile(); // Update file content
    vscode.window.showInformationMessage(
      `Constant ${constant.name} created successfully!`,
    );
    this.updateWebview();
  }

  private editConstant(constant: MoveConstant, originalName: string) {
    // Remove the old constant if name has changed
    if (originalName !== constant.name) {
      this._constants = this._constants.filter((c) => c.name !== originalName);
    }

    // Update or add the new constant
    const existingIndex = this._constants.findIndex(
      (c) => c.name === constant.name,
    );
    if (existingIndex !== -1) {
      this._constants[existingIndex] = constant;
    } else {
      this._constants.push(constant);
    }

    this.updateMoveFile();
    vscode.window.showInformationMessage(
      `Constant ${constant.name} updated successfully!`,
    );
    this.updateWebview();
  }

  private deleteConstant(constantName: string) {
    this._constants = this._constants.filter((c) => c.name !== constantName);
    this.updateWebview();
    vscode.window.showInformationMessage(`Constant ${constantName} deleted.`);
    this.updateMoveFile(); // Update file content
  }

  private saveConstants() {
    this._context.globalState.update(this._storageKey, this._constants);
  }

  private loadSavedConstants() {
    const savedConstants = this._context.globalState.get<MoveConstant[]>(
      this._storageKey,
    );
    if (savedConstants) {
      this._constants = savedConstants;
    }
  }

  private updateWebview() {
    if (this._view) {
      // Update the webview to show current constants
      this._view.webview.postMessage({
        command: "updateConstantList",
        constants: this._constants,
      });
    }
  }

  // Optional: Method to get all created constants
  public getConstants(): MoveConstant[] {
    return this._constants;
  }
}
