import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseMoveFile, updateMoveFileGeneral } from "../utils/help";
import { parseMoveFile as parseResponse } from "../utils/helpers";
import { MoveStruct, MoveFunction, MoveConstant } from "../types";
import { AssistantView } from "./AssistantView";

export class FunctionsView implements vscode.WebviewViewProvider {
  public static readonly viewType = "moveAssistant.functions";
  private _view?: vscode.WebviewView;
  private _functions: MoveFunction[] = [];
  private _structs: MoveStruct[] = [];
  private _testImports: string[] = [];
  private _imports: string[] = [];
  private _constants: MoveConstant[] = [];
  private _testFunctions: MoveFunction[] = [];
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
    this._testFunctions = testFunctions;
    this._functions = functions;
    this._constants = constants;
    this._testImports = testImports;
    this._imports = imports;
    // console.log(this._f[0], "first");
    // console.log(await parseMoveFile(this._context), "functions");
    this._context.workspaceState.update("imports", imports);
    this._context.workspaceState.update("testImports", testImports);
    this._context.workspaceState.update("constants", constants);
    this._context.workspaceState.update("structs", structs);
    this._context.workspaceState.update("functions", functions);
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

  private async updateMoveFile(): Promise<void> {
    await updateMoveFileGeneral(this._context, {
      functions: this._functions as MoveFunction[],
      structs: this._structs as MoveStruct[],
      constants: this._constants,
      imports: this._imports,
      testImports: this._testImports,
      testFunctions: this._testFunctions as MoveFunction[],
    });
    if (this.refreshView) {
      this.refreshView();
    }
  }

  private async createFunction(func: MoveFunction) {
    console.log(this._functions, "functions");
    const prompt = `
${JSON.stringify(this._structs, null, 2)}
  You are an expert Sui Move developer. Using the above structs as a helper, Complete the function body for the following Move function: Return for me only the function and any other new constant, import or struct created or used. If not just return for me the function.
  Function Name: ${func.name}
  Function Type: ${func.type}
  Description: ${func.description}
  Parameters: ${func.params}
  Return Type: ${func.returns}



  Note: The option and tx_object modules are being used by default. No need to import them.
  `;
    const data = await this._assistantView?.handleUserMessage(
      prompt,
      "function",
    );
    console.log(data);

    // Parse the response to extract functions, constants, imports and structs
    const { functions, constants, imports, structs } = parseResponse(
      data as string,
    );

    // Process the new function
    const newFunc = functions[0];
    console.log(newFunc, "new function");
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

    // Process any new constants
    if (constants && constants.length > 0) {
      for (const newConstant of constants) {
        // Check if constant already exists
        const existingConstantIndex = this._constants.findIndex(
          (c) => c.name === newConstant.name,
        );

        if (existingConstantIndex !== -1) {
          // Update existing constant
          this._constants[existingConstantIndex] = newConstant;
        } else {
          // Add new constant
          this._constants.push(newConstant);
        }
      }
    }

    // Process any new imports
    if (imports && imports.length > 0) {
      for (const newImport of imports) {
        // Check if the import already exists
        const importExists = this._imports.some((i) => i === newImport);

        if (!importExists) {
          // Add new import only if it doesn't exist
          this._imports.push(newImport);
        }
      }
    }

    // Process any new structs (optional, based on your data model)
    if (structs && structs.length > 0) {
      for (const newStruct of structs) {
        const existingStructIndex = this._structs.findIndex(
          (s) => s.name === newStruct.name,
        );

        if (existingStructIndex !== -1) {
          // Update existing struct
          this._structs[existingStructIndex] = newStruct;
        } else {
          // Add new struct
          this._structs.push(newStruct);
        }
      }
    }

    // Update file content with all the changes
    await this.updateMoveFile();

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
