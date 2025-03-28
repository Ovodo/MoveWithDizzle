// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { MoveStructsView } from "./panels/MoveStructsView";
import { WelcomeView } from "./panels/WelcomeVIew";
import { MoveFunctionsView } from "./panels/MoveFunctionsView";
import { MoveSnippetsView } from "./panels/MoveSnippetsView";

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

  // Register "Start Contract" Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "movewithdizzle.startContract",
      async () => {
        await startNewContract();
      }
    )
  );

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
    MoveSnippetsView.viewType,
    new MoveSnippetsView(context)
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
