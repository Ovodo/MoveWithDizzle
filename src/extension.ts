// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { StructsView } from "./panels/StructsView";
import { WelcomeView } from "./panels/WelcomeVIew";
import { FunctionsView } from "./panels/FunctionsView";
import { AssistantView } from "./panels/AssistantView";
import { exec } from "child_process";
import { PackageTreeProvider } from "./panels/PackageTreeProvider";
import { fetchPackageInfo } from "./utils/fetchPackageInfo";
import { ConstantsView } from "./panels/ConstView";
import { ImportsView } from "./panels/ImportsView";
import { formatMoveFile } from "./utils/helpers";
import { TestFunctionsView } from "./panels/TestFunctionsView";
import { SuiExamplesView } from "./panels/SuiExamplesView";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "movewithdizzle" is now active!',
  );

  // vscode.workspace.onDidSaveTextDocument((document) => {
  //   console.log("File saved:", document.fileName);
  //   if (document === vscode.window.activeTextEditor?.document) {
  //     // Format on save
  //     formatMoveFile(context, document.getText());
  //   }
  // });

  // vscode.languages.registerDocumentFormattingEditProvider("move", {
  //   async provideDocumentFormattingEdits(
  //     document: vscode.TextDocument,
  //   ): Promise<vscode.TextEdit[]> {
  //     const firstLine = document.lineAt(0);
  //     // if (firstLine.text !== "42") {
  //     const text = await formatMoveFile(context, document.getText());
  //     return [vscode.TextEdit.insert(firstLine.range.start, "42\n")];
  //     // }
  //   },
  // });

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "movewithdizzle.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Welcome to MoveWithDizzle!");
    },
  );
  context.subscriptions.push(disposable);

  /*==============================================================================================
  	  Commands
  	==============================================================================================*/

  // Register "Deploy" Command

  const deployCommand = vscode.commands.registerCommand(
    "movewithdizzle.deployContract",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return;
      }
      const filePath = editor.document.uri.fsPath;
      if (!filePath.endsWith(".move")) {
        vscode.window.showErrorMessage("This is not a Move file.");
        return;
      }
      // Get the folder containing Move.toml
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        editor.document.uri,
      );
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("Could not locate workspace folder.");
        return;
      }
      const folderPath = workspaceFolder.uri.fsPath;

      // Show progress notification
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Deploying Move contract...",
          cancellable: false,
        },
        async (progress) => {
          let terminalOutput = "";

          // Execute command and capture output
          const execCommand = (command: string) => {
            return new Promise((resolve, reject) => {
              exec(command, { cwd: folderPath }, (error, stdout, stderr) => {
                if (error) {
                  reject(error);
                  return;
                }

                const output = stdout + stderr;
                terminalOutput += output;
                resolve(output);
              });
            });
          };

          try {
            // Build the Move contract
            progress.report({ message: "Building Move contract..." });
            await execCommand("sui move build");

            // Publish the contract
            progress.report({ message: "Publishing to Sui network..." });
            await execCommand("sui client publish --gas-budget 100000000");

            // Extract contract address from output
            const packageIdMatch = terminalOutput.match(
              /PackageID: (0x[0-9a-fA-F]+)/,
            );
            if (packageIdMatch && packageIdMatch[1]) {
              const packageId = packageIdMatch[1];

              // Store in extension state - keeping the original storage method
              context.workspaceState.update("CA", packageId);
              // Fetch real module/object data
              const pkgInfo = await fetchPackageInfo(packageId);
              treeProvider.refresh(pkgInfo); // ← now fully loaded

              // Show success message with copy option
              const copyAction = "Copy Package ID";
              const result = await vscode.window.showInformationMessage(
                `Contract deployed successfully! Package ID: ${packageId}`,
                copyAction,
              );

              // Copy to clipboard if copy action was selected
              if (result === copyAction) {
                await vscode.env.clipboard.writeText(packageId);
                vscode.window.showInformationMessage(
                  "Package ID copied to clipboard!",
                );
              }
            } else {
              vscode.window.showErrorMessage(
                "Failed to extract Package ID from deployment output.",
              );
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Deployment failed: ${error.message || error}`,
            );
          }
        },
      );
    },
  );

  context.subscriptions.push(deployCommand);

  // Register "Start Contract" Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "movewithdizzle.startContract",
      async () => {
        await startNewContract();
      },
    ),
  );

  const formatMoveFileCommand = vscode.commands.registerCommand(
    "movewithdizzle.formatMoveFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return;
      }

      const document = editor.document;
      if (!document.fileName.endsWith(".move")) {
        vscode.window.showErrorMessage("This is not a Move file.");
        return;
      }

      const fileContent = document.getText();

      try {
        // Find the module declaration with updated regex to handle all styles
        const moduleDeclarationRegex = /module\s+(?:\w+::)*\w+\s*(?:\{|\s*;)/;
        const moduleMatch = moduleDeclarationRegex.exec(fileContent);

        if (!moduleMatch) {
          vscode.window.showErrorMessage("No valid module declaration found.");
          return;
        }

        // Get the formatted content
        const formattedContent = await formatMoveFile(context);

        // Get the content above and including module declaration
        const contentAboveModule = fileContent.substring(
          0,
          moduleMatch.index + moduleMatch[0].length,
        );

        const edit = new vscode.WorkspaceEdit();
        const rangeToReplace = new vscode.Range(
          document.positionAt(moduleMatch.index + moduleMatch[0].length),
          document.positionAt(fileContent.length),
        );

        // Replace everything after module declaration with formatted content
        edit.replace(document.uri, rangeToReplace, formattedContent);
        await vscode.workspace.applyEdit(edit);

        vscode.window.showInformationMessage("File formatted successfully.");
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Failed to format file: ${error.message || error}`,
        );
      }
    },
  );

  context.subscriptions.push(formatMoveFileCommand);

  const treeProvider = new PackageTreeProvider(context);
  vscode.window.registerTreeDataProvider("moveContractView", treeProvider);

  const welcomeView = vscode.window.registerWebviewViewProvider(
    WelcomeView.viewType,
    new WelcomeView(context),
  );
  context.subscriptions.push(welcomeView);

  const structView = vscode.window.registerWebviewViewProvider(
    StructsView.viewType,
    new StructsView(context),
  );
  context.subscriptions.push(structView);
  const functionsView = new FunctionsView(context);
  const assistantView = new AssistantView(context);

  functionsView.setAssistantView(assistantView);
  const functionsContext = vscode.window.registerWebviewViewProvider(
    FunctionsView.viewType,
    functionsView,
  );
  context.subscriptions.push(functionsContext);

  const assistantContext = vscode.window.registerWebviewViewProvider(
    AssistantView.viewType,
    assistantView,
  );

  context.subscriptions.push(assistantContext);

  const constantsView = vscode.window.registerWebviewViewProvider(
    ConstantsView.viewType,
    new ConstantsView(context),
  );
  context.subscriptions.push(constantsView);

  const testFunctionsView = new TestFunctionsView(context);
  context.subscriptions.push(testFunctionsView);

  // Initialize Sui Examples View
  const suiExamplesView = new SuiExamplesView(context);

  const importsView = new ImportsView(context);
  context.subscriptions.push(importsView);

  async function startNewContract() {
    // Prompt user for the contract name
    const contractName = await vscode.window.showInputBox({
      prompt: "Enter the name of your Move contract",
      placeHolder: "marketplace",
      validateInput: (text) => {
        return text.trim().length === 0
          ? "Contract name cannot be empty"
          : null;
      },
    });

    if (!contractName) {
      vscode.window.showErrorMessage("Contract creation canceled.");
      return;
    }

    // Open a new terminal and run the sui move new command with the contract name
    const terminal = vscode.window.createTerminal("Move Contract");
    terminal.show();
    terminal.sendText(`sui move new ${contractName}`);

    // Enable the other views
    await vscode.commands.executeCommand(
      "setContext",
      "moveWithDizzle.started",
      true,
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
