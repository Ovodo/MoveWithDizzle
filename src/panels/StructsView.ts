import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseMoveFile } from "../utils/helpers";

export interface StructField {
  name: string;
  type: string;
}

export interface MoveStruct {
  name: string;
  abilities: string[];
  fields: StructField[];
}

export class StructsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.structs";
  private _view?: vscode.WebviewView;
  private _structs: MoveStruct[] = [];
  private _storageKey = "moveAssistant.savedStructs";

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved structs on initialization
    this.loadSavedStructs();
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
    const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (!currentFile) {
      webviewView.webview.html = "<h3>Please start a contract first.</h3>";
      return;
    }

    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "src", "media")),
      ],
    };

    // Load existing structs from the file

    // Send extracted structs to the webview
    this.refreshView();

    // Set webview HTML with full struct creation interface
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        console.log("Received message:", message);
        switch (message.command) {
          case "createStruct":
            // console.log("Creawtings struct:", message.name.length);
            console.log("Creating struct:", message.struct);
            this.createStruct(message.struct);
            return;
          case "editStruct":
            // console.log("Editing struct:", message.name.length);
            this.editStruct(message.struct);
            return;
          case "requestDeleteStruct":
            vscode.window
              .showWarningMessage(
                `Are you sure you want to delete struct "${message.structName}"?`,
                { modal: true },
                "Delete",
              )
              .then((selection) => {
                if (selection === "Delete") {
                  this.deleteStruct(message.structName);
                }
              });
            return;
          case "deleteStruct":
            console.log("Deleting struct:", message.structName);
            this.deleteStruct(message.structName);
            return;
          case "loadInitialStructs":
            console.log("Loading initial structs");
            this.sendInitialStructs();
            return;
          default:
            console.log("Unknown command:", message?.command);
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  private sendInitialStructs() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "initialStructs",
        structs: this._structs,
      });
      this._context.globalState.update("structs", this._structs);
    }
  }

  private refreshView() {
    const { structs } = parseMoveFile();
    this._structs = structs;
    this.sendInitialStructs();
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "structs.html",
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

  private updateMoveFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const document = editor.document;
    let text = document.getText();

    // Step 1: Remove all structs that no longer exist in this._structs
    text = text.replace(
      /(?:public\s+)?struct\s+(\w+)\s*(?:has\s+((?:key|store|copy|drop)(?:\s*,\s*(?:key|store|copy|drop))*))?\s*{[^}]*}/g,
      (match, structName) => {
        return this._structs.some((s) => s.name === structName) ? match : "";
      },
    );

    // Step 2: Remove extra blank lines caused by deletion
    text = text.replace(/\n\s*\n/g, "\n").trim();

    // Step 3: Update or add structs that exist in this._structs
    const structDeclarations: string[] = [];
    this._structs.forEach((struct) => {
      const structRegex = new RegExp(
        `(?:public\\s+)?struct\\s+${struct.name}\\s*(?:has\\s+(?:key|store|copy|drop)(?:\\s*,\\s*(?:key|store|copy|drop))*)?\\s*{[^}]*}`,
        "g",
      );

      const abilitiesString =
        struct.abilities.length > 0
          ? `has ${struct.abilities.join(", ")} `
          : "";

      const childTypes = ["Option", "vector"];
      console.log(struct.fields, "fields");
      const newStructText =
        `public struct ${struct.name} ${abilitiesString}{\n` +
        struct.fields
          .map(
            (f) =>
              `  \t\t${f.name}: ${
                childTypes.includes(f.type) ? f.type.concat("<>") : f.type
              },`,
          )
          .join("\n") +
        `\n\t}\n`;

      if (text.match(structRegex)) {
        text = text.replace(structRegex, newStructText);
      } else {
        structDeclarations.push(newStructText);
      }
    });

    // Append new structs below the last struct declaration
    if (structDeclarations.length > 0) {
      const lastStructMatch = text.match(
        /(?:public\s+)?struct\s+\w+\s*(?:has\s+(?:key|store|copy|drop)(?:\s*,\s*(?:key|store|copy|drop))*)?\s*{[^}]*}/g,
      );
      const lastStructIndex = lastStructMatch
        ? text.lastIndexOf(lastStructMatch[lastStructMatch.length - 1])
        : -1;

      if (lastStructIndex !== -1) {
        const insertPosition = text.indexOf("}", lastStructIndex) + 1; // Find the end of the last struct
        text =
          text.slice(0, insertPosition) +
          `\n\n` +
          structDeclarations.join("\n\n") +
          text.slice(insertPosition);
      } else {
        text += `\n\n${structDeclarations.join("\n\n")}`;
      }
    }

    // Apply changes to the editor
    editor.edit((editBuilder) => {
      const all = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      editBuilder.replace(all, text);
    });
  }

  private createStruct(struct: MoveStruct) {
    console.log(this._structs, "structs");

    const existingStructIndex = this._structs.findIndex(
      (s) => s.name === struct.name,
    );

    if (existingStructIndex !== -1) {
      this._structs[existingStructIndex] = struct;
    } else {
      this._structs.push(struct);
    }

    this.updateMoveFile(); // Update file content
    vscode.window.showInformationMessage(
      `Struct ${struct.name} created successfully!`,
    );
    this.updateWebview();
  }

  private editStruct(struct: MoveStruct) {
    console.log("Editing struct:", struct);
    console.log("Current structs:", this._structs);

    const existingStructIndex = this._structs.findIndex(
      (s) => s.name === struct.name,
    );

    console.log("Existing struct index:", existingStructIndex);

    if (existingStructIndex !== -1) {
      // Update the existing struct
      this._structs[existingStructIndex] = struct;

      // Update the file content
      this.updateMoveFile();

      vscode.window.showInformationMessage(
        `Struct ${struct.name} updated successfully!`,
      );

      this.updateWebview();
    } else {
      vscode.window.showWarningMessage(
        `No struct found with name ${struct.name} to update`,
      );
    }
  }
  private deleteStruct(structName: string) {
    this._structs = this._structs.filter((s) => s.name !== structName);
    this.updateWebview();
    vscode.window.showInformationMessage(`Struct ${structName} deleted.`);
    this.updateMoveFile(); // Update file content
  }

  private saveStructs() {
    this._context.globalState.update(this._storageKey, this._structs);
  }

  private loadSavedStructs() {
    const savedStructs = this._context.globalState.get<MoveStruct[]>(
      this._storageKey,
    );
    if (savedStructs) {
      this._structs = savedStructs;
    }
  }

  private updateWebview() {
    if (this._view) {
      // Update the webview to show current structs
      this._view.webview.postMessage({
        command: "updateStructList",
        structs: this._structs,
      });
    }
  }

  // Optional: Method to get all created structs
  public getStructs(): MoveStruct[] {
    return this._structs;
  }
}
