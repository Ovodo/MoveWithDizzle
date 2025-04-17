import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseMoveFile } from "../utils/help";
import { MoveStruct } from "./StructsView";
import { AssistantView } from "./AssistantView";

export interface FunctionParam {
  name: string;
  type: string;
  description: string;
}

export interface MoveFunction {
  name: string;
  type: string; // public, private, or entry
  description: string;
  params: FunctionParam[];
  returns: string;
  body: string;
}

export class FunctionsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.functions";
  private _view?: vscode.WebviewView;
  private _functions: MoveFunction[] = [];
  private _structs: MoveStruct[] = [];
  private _storageKey = "moveAssistant.savedFunctions";
  private _assistantView?: AssistantView;

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved functions on initialization
    this.loadSavedFunctions();
    // Listen for file save or editor change events
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

  setAssistantView(assistantView: AssistantView) {
    this._assistantView = assistantView;
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

    // Send extracted functions to the webview
    this.sendInitialFunctions();

    // Set webview HTML with full function creation interface
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );
    this.refreshView();

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        console.log("Received message:", message);
        switch (message.command) {
          case "createFunction":
            console.log("Creating function:", message.func);
            this.createFunction(message.func);
            return;
          case "editFunction":
            this.editFunction(message.func);
            return;
          case "requestDeleteFunction":
            vscode.window
              .showWarningMessage(
                `Are you sure you want to delete function "${message.functionName}"?`,
                { modal: true },
                "Delete",
              )
              .then((selection) => {
                if (selection === "Delete") {
                  this.deleteFunction(message.functionName);
                }
              });
            return;
          case "deleteFunction":
            console.log("Deleting function:", message.functionName);
            this.deleteFunction(message.functionName);
            return;
          case "loadInitialFunctions":
            console.log("Loading initial functions");
            this.sendInitialFunctions();
            return;
          default:
            console.log("Unknown command:", message?.command);
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  private sendInitialFunctions() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "initialFunctions",
        functions: this._functions,
        structs: this._structs,
      });
    }
  }

  private async refreshView() {
    const {
      imports,
      testImports,
      constants,
      structs,
      functions,
      testFunctions,
    } = await parseMoveFile(this._context);
    this._functions = functions;
    this._structs = structs;
    // console.log(this._f[0], "first");
    console.log(await parseMoveFile(this._context), "functions");
    this._context.workspaceState.update("imports", imports);
    this._context.workspaceState.update("testImports", testImports);
    this._context.workspaceState.update("constants", constants);
    this._context.workspaceState.update("structs", structs);
    this._context.workspaceState.update("funsctions", functions);
    this._context.workspaceState.update("testFunctions", testFunctions);

    this.sendInitialFunctions();
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "functions.html",
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

    // Better pattern to match Move functions, including proper nested brace handling
    const visibilityPattern = `(?:public\\(package\\)|public|private|entry)?`;
    const funcPattern = new RegExp(
      `(?:\\/\\*[\\s\\S]*?\\*\\/|(?:\\/\\/\\s*@description.*\\n))?\\s*${visibilityPattern}\\s*fun\\s+(\\w+)\\s*\\([^)]*\\)(?:\\s*:\\s*[^{]+)?\\s*\\{([\\s\\S]*?)\\}`,
      "g",
    );

    // Step 1: First identify all functions in the text
    const existingFunctions = new Map();
    let match;
    while ((match = funcPattern.exec(text)) !== null) {
      const [fullMatch, funcName] = match;
      existingFunctions.set(funcName, fullMatch);
    }

    // Step 2: Build new text content from scratch
    let newText = text.split(funcPattern)[0].trim(); // Keep header content

    // Step 3: Update or append functions
    const processedFunctions = new Set();
    this._functions.forEach((func) => {
      processedFunctions.add(func.name);

      const description = func.description
        ? `/*\n    ${func.description}\n` +
          func.params
            .map((p) => `    @param ${p.name} - ${p.type}\n`)
            .join("") +
          (func.returns ? `    @return - ${func.returns}\n` : "") +
          `*/\n`
        : "";

      const params = func.params.map((p) => `${p.name}: ${p.type}`).join(", ");
      const returns = func.returns ? `: ${func.returns}` : "";
      const visibility =
        func.type === "private" ? "" : func.type ? `${func.type} ` : "";

      const newFunctionText =
        `${description}${visibility}fun ${func.name}(${params})${returns} {\n` +
        `    ${func.body}\n` +
        `}`;

      // Add newlines before function if needed
      if (newText.length > 0 && !newText.endsWith("\n\n")) {
        newText += newText.endsWith("\n") ? "\n" : "\n\n";
      }

      newText += newFunctionText;
    });

    // Copy over any functions from the original that aren't in our list
    existingFunctions.forEach((functionText, funcName) => {
      if (!processedFunctions.has(funcName)) {
        // Add newlines before function if needed
        if (newText.length > 0 && !newText.endsWith("\n\n")) {
          newText += newText.endsWith("\n") ? "\n" : "\n\n";
        }

        newText += functionText;
      }
    });

    // Step 4: Apply updated text to the document
    editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      editBuilder.replace(fullRange, newText);
    });
  }

  private async createFunction(func: MoveFunction) {
    console.log(this._functions, "functions");

    const data = await this._assistantView?.completeFunctionBody(
      func,
      this._structs,
    );
    const { functions } = await parseMoveFile(this._context, data as string);
    const newFunc = functions[0];

    const existingFunctionIndex = this._functions.findIndex(
      (f) => f.name === func.name,
    );

    if (existingFunctionIndex !== -1) {
      this._functions[existingFunctionIndex] = {
        ...newFunc,
        description: func.description,
      } as MoveFunction;
    } else {
      this._functions.push({
        ...newFunc,
        description: func.description,
      } as MoveFunction);
    }

    this.updateMoveFile(); // Update file content
    vscode.window.showInformationMessage(
      `Function ${func.name} created successfully!`,
    );
    this.updateWebview();
  }

  private editFunction(func: MoveFunction) {
    console.log("Editing function:", func);
    console.log("Current functions:", this._functions);

    const existingFunctionIndex = this._functions.findIndex(
      (f) => f.name === func.name,
    );

    console.log("Existing function index:", existingFunctionIndex);

    if (existingFunctionIndex !== -1) {
      // Update the existing function
      this._functions[existingFunctionIndex] = func;

      // Update the file content
      this.updateMoveFile();

      vscode.window.showInformationMessage(
        `Function ${func.name} updated successfully!`,
      );

      this.updateWebview();
    } else {
      vscode.window.showWarningMessage(
        `No function found with name ${func.name} to update`,
      );
    }
  }

  private deleteFunction(functionName: string) {
    this._functions = this._functions.filter((f) => f.name !== functionName);
    this.updateWebview();
    vscode.window.showInformationMessage(`Function ${functionName} deleted.`);
    this.updateMoveFile(); // Update file content
  }

  private saveFunctions() {
    this._context.globalState.update(this._storageKey, this._functions);
  }

  private loadSavedFunctions() {
    const savedFunctions = this._context.globalState.get<MoveFunction[]>(
      this._storageKey,
    );
    if (savedFunctions) {
      this._functions = savedFunctions;
    }
  }

  private updateWebview() {
    if (this._view) {
      // Update the webview to show current functions
      this._view.webview.postMessage({
        command: "updateFunctionList",
        functions: this._functions,
      });
    }
  }

  // Optional: Method to get all created functions
  public getFunctions(): MoveFunction[] {
    return this._functions;
  }
}
