import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseMoveFile } from "../utils/help";
import { MoveStruct } from "./StructsView";
import { AssistantView } from "./AssistantView";

export interface TestFunction {
  name: string;
  description: string;
  params: TestFunctionParam[];
  body: string;
}

export interface TestFunctionParam {
  name: string;
  type: string;
  description: string;
}

export class TestFunctionsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.testFunctions";
  private _view?: vscode.WebviewView;
  private _testFunctions: TestFunction[] = [];
  private _structs: MoveStruct[] = [];
  private _storageKey = "moveAssistant.savedTestFunctions";
  private _assistantView?: AssistantView;

  constructor(private readonly _context: vscode.ExtensionContext) {
    // Load saved test functions on initialization
    this.loadSavedTestFunctions();

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

    // Send extracted test functions to the webview
    this.sendInitialTestFunctions();

    // Set webview HTML with full test function creation interface
    webviewView.webview.html = this.getWebviewContent(
      this._context,
      webviewView.webview,
    );
    this.refreshView();

    webviewView.webview.onDidReceiveMessage(
      (message) => {
        console.log("Received message:", message);
        switch (message.command) {
          case "createTestFunction":
            console.log("Creating test function:", message.func);
            this.createTestFunction(message.func);
            return;
          case "editTestFunction":
            this.editTestFunction(message.func);
            return;
          case "requestDeleteTestFunction":
            vscode.window
              .showWarningMessage(
                `Are you sure you want to delete test function "${message.functionName}"?`,
                { modal: true },
                "Delete",
              )
              .then((selection) => {
                if (selection === "Delete") {
                  this.deleteTestFunction(message.functionName);
                }
              });
            return;
          case "deleteTestFunction":
            console.log("Deleting test function:", message.functionName);
            this.deleteTestFunction(message.functionName);
            return;
          case "loadInitialTestFunctions":
            console.log("Loading initial test functions");
            this.sendInitialTestFunctions();
            return;
          default:
            console.log("Unknown command:", message?.command);
        }
      },
      undefined,
      this._context.subscriptions,
    );
  }

  private sendInitialTestFunctions() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "initialTestFunctions",
        functions: this._testFunctions,
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

    this._testFunctions = testFunctions;
    this._structs = structs;

    console.log(await parseMoveFile(this._context), "test functions");
    this._context.workspaceState.update("imports", imports);
    this._context.workspaceState.update("testImports", testImports);
    this._context.workspaceState.update("constants", constants);
    this._context.workspaceState.update("structs", structs);
    this._context.workspaceState.update("functions", functions);
    this._context.workspaceState.update("testFunctions", testFunctions);

    this.sendInitialTestFunctions();
  }

  private getWebviewContent(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
  ): string {
    const htmlPath = path.join(
      context.extensionPath,
      "src",
      "media",
      "test.html",
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

    // Pattern to match Move test functions
    const testFuncPattern = new RegExp(
      `(?:\\/\\*[\\s\\S]*?\\*\\/|(?:\\/\\/\\s*@description.*\\n))?\\s*#\\[test\\]\\s*fun\\s+(\\w+)\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}`,
      "g",
    );

    // Step 1: First identify all test functions in the text
    const existingTestFunctions = new Map();
    let match;
    while ((match = testFuncPattern.exec(text)) !== null) {
      const [fullMatch, funcName] = match;
      existingTestFunctions.set(funcName, fullMatch);
    }

    // Step 2: Build new text content, keeping existing regular functions
    // First find the last non-test function or end of module definition
    const moduleEndPattern = /}[\s]*$/; // Match the last closing brace of the module
    const matchModule = moduleEndPattern.exec(text);

    if (!matchModule) {
      vscode.window.showErrorMessage(
        "Could not locate end of module to add test functions",
      );
      return;
    }

    // Split the content: everything before the module end
    const endIndex = matchModule.index;
    let contentBeforeEnd = text.substring(0, endIndex);

    // Add test module if it doesn't exist yet
    if (!contentBeforeEnd.includes("#[test_only]")) {
      contentBeforeEnd += "\n\n#[test_only]\nmodule self::tests {\n";

      // Add essential test imports if not already present
      if (!contentBeforeEnd.includes("use sui::test_scenario")) {
        contentBeforeEnd += "    use sui::test_scenario;\n";
      }

      // Process all test functions
      this._testFunctions.forEach((func) => {
        const description = func.description
          ? `    /*\n    ${func.description}\n` +
            func.params
              .map((p) => `    @param ${p.name} - ${p.type}\n`)
              .join("") +
            `    */\n`
          : "";

        const params = func.params
          .map((p) => `${p.name}: ${p.type}`)
          .join(", ");

        const testFunctionText =
          `${description}    #[test]\n    fun ${func.name}(${params}) {\n` +
          `        ${func.body}\n` +
          `    }\n`;

        contentBeforeEnd += testFunctionText;
      });

      // Close the test module
      contentBeforeEnd += "}\n";
    } else {
      // Test module already exists, find where to insert the tests
      const testModulePattern =
        /#\[test_only\]\s*module\s+self::tests\s*\{([^}]*)/;
      const testModuleMatch = testModulePattern.exec(contentBeforeEnd);

      if (testModuleMatch) {
        const testModuleStart =
          testModuleMatch.index + testModuleMatch[0].length;
        const testModuleContent = testModuleMatch[1];

        // Build existing content with updated test functions
        const beforeTestModule = contentBeforeEnd.substring(0, testModuleStart);
        let newTestModuleContent = testModuleContent;

        // Remove existing test functions that will be replaced
        this._testFunctions.forEach((func) => {
          const funcPattern = new RegExp(
            `\\s*#\\[test\\]\\s*fun\\s+${func.name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`,
            "g",
          );
          newTestModuleContent = newTestModuleContent.replace(funcPattern, "");
        });

        // Add all test functions
        let testFunctionsText = "";
        this._testFunctions.forEach((func) => {
          const description = func.description
            ? `    /*\n    ${func.description}\n` +
              func.params
                .map((p) => `    @param ${p.name} - ${p.type}\n`)
                .join("") +
              `    */\n`
            : "";

          const params = func.params
            .map((p) => `${p.name}: ${p.type}`)
            .join(", ");

          testFunctionsText +=
            `${description}    #[test]\n    fun ${func.name}(${params}) {\n` +
            `        ${func.body}\n` +
            `    }\n\n`;
        });

        // Combine everything back
        contentBeforeEnd =
          beforeTestModule + newTestModuleContent + testFunctionsText + "}";
      }
    }

    // Step 4: Apply updated text to the document
    editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      editBuilder.replace(fullRange, contentBeforeEnd);
    });
  }

  private async createTestFunction(func: TestFunction) {
    console.log(this._testFunctions, "test functions");

    const data = await this._assistantView?.completeTestFunctionBody(
      func,
      this._structs,
    );

    // Parse the returned test function data
    // This assumes parseMoveFile can handle extracting test functions
    const { testFunctions } = await parseMoveFile(
      this._context,
      data as string,
    );
    const newFunc = testFunctions[0];

    const existingFunctionIndex = this._testFunctions.findIndex(
      (f) => f.name === func.name,
    );

    if (existingFunctionIndex !== -1) {
      this._testFunctions[existingFunctionIndex] = {
        ...newFunc,
        description: func.description,
      } as TestFunction;
    } else {
      this._testFunctions.push({
        ...newFunc,
        description: func.description,
      } as TestFunction);
    }

    this.updateMoveFile(); // Update file content
    vscode.window.showInformationMessage(
      `Test function ${func.name} created successfully!`,
    );
    this.updateWebview();
  }

  private editTestFunction(func: TestFunction) {
    console.log("Editing test function:", func);
    console.log("Current test functions:", this._testFunctions);

    const existingFunctionIndex = this._testFunctions.findIndex(
      (f) => f.name === func.name,
    );

    console.log("Existing test function index:", existingFunctionIndex);

    if (existingFunctionIndex !== -1) {
      // Update the existing test function
      this._testFunctions[existingFunctionIndex] = func;

      // Update the file content
      this.updateMoveFile();

      vscode.window.showInformationMessage(
        `Test function ${func.name} updated successfully!`,
      );

      this.updateWebview();
    } else {
      vscode.window.showWarningMessage(
        `No test function found with name ${func.name} to update`,
      );
    }
  }

  private deleteTestFunction(functionName: string) {
    this._testFunctions = this._testFunctions.filter(
      (f) => f.name !== functionName,
    );
    this.updateWebview();
    vscode.window.showInformationMessage(
      `Test function ${functionName} deleted.`,
    );
    this.updateMoveFile(); // Update file content
  }

  private saveTestFunctions() {
    this._context.globalState.update(this._storageKey, this._testFunctions);
  }

  private loadSavedTestFunctions() {
    const savedTestFunctions = this._context.globalState.get<TestFunction[]>(
      this._storageKey,
    );
    if (savedTestFunctions) {
      this._testFunctions = savedTestFunctions;
    }
  }

  private updateWebview() {
    if (this._view) {
      // Update the webview to show current test functions
      this._view.webview.postMessage({
        command: "updateTestFunctionList",
        functions: this._testFunctions,
        structs: this._structs,
      });
    }
  }

  // Method to get all created test functions
  public getTestFunctions(): TestFunction[] {
    return this._testFunctions;
  }
}
