// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { MoveStructsView } from "./panels/MoveStructsView";
import { WelcomeView } from "./panels/WelcomeVIew";
import { MoveFunctionsView } from "./panels/MoveFunctionsView";
import { MoveAssistantView } from "./panels/MoveAssistantView";
import { exec } from "child_process";
import { PackageTreeProvider } from "./panels/PackageTreeProvider";
import { fetchPackageInfo } from "./utils/fetchPackageInfo";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "movewithdizzle" is now active!'
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "movewithdizzle.helloWorld",
    () => {
      // The code you place here will be executed every time your command is executed
      // Display a message box to the user
      vscode.window.showInformationMessage("Welcome to MoveWithDizzle!");
    }
  );
  context.subscriptions.push(disposable);

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
        editor.document.uri
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
              /PackageID: (0x[0-9a-fA-F]+)/
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
                copyAction
              );

              // Copy to clipboard if copy action was selected
              if (result === copyAction) {
                await vscode.env.clipboard.writeText(packageId);
                vscode.window.showInformationMessage(
                  "Package ID copied to clipboard!"
                );
              }
            } else {
              vscode.window.showErrorMessage(
                "Failed to extract Package ID from deployment output."
              );
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Deployment failed: ${error.message || error}`
            );
          }
        }
      );
    }
  );

  context.subscriptions.push(deployCommand);

  // Register "Start Contract" Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "movewithdizzle.startContract",
      async () => {
        await startNewContract();
      }
    )
  );

  const treeProvider = new PackageTreeProvider(context);
  vscode.window.registerTreeDataProvider("moveContractView", treeProvider);

  const welcomeView = vscode.window.registerWebviewViewProvider(
    WelcomeView.viewType,
    new WelcomeView(context)
  );
  context.subscriptions.push(welcomeView);

  const structView = vscode.window.registerWebviewViewProvider(
    MoveStructsView.viewType,
    new MoveStructsView(context)
  );
  context.subscriptions.push(structView);

  const functionsView = vscode.window.registerWebviewViewProvider(
    MoveFunctionsView.viewType,
    new MoveFunctionsView(context)
  );
  context.subscriptions.push(functionsView);

  const snippetsView = vscode.window.registerWebviewViewProvider(
    MoveAssistantView.viewType,
    new MoveAssistantView(context)
  );

  context.subscriptions.push(snippetsView);

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
      true
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
