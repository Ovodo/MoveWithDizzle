import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SuiExamplesProvider, SuiExampleItem } from "./SuiExamplesProvider";
import { SuiExampleRenderer } from "./SuiExampleRenderer";

/**
 * SuiExamplesView manages the tree view for Sui blockchain examples
 */
export class SuiExamplesView {
  private examplesProvider: SuiExamplesProvider;
  private treeView: vscode.TreeView<SuiExampleItem>;

  constructor(context: vscode.ExtensionContext) {
    // Set the path to the Sui examples folder
    const suiExamplesPath = path.join(context.extensionPath, "sui", "examples");

    // Create the tree data provider
    this.examplesProvider = new SuiExamplesProvider(suiExamplesPath);

    // Create the tree view
    this.treeView = vscode.window.createTreeView("moveWithDizzleSuiExamples", {
      treeDataProvider: this.examplesProvider,
      showCollapseAll: true,
    });

    // Register refresh command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "moveWithDizzle.suiExamples.refresh",
        () => {
          this.refresh();
        },
      ),
    );

    // Register command to copy example to workspace
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "moveWithDizzle.suiExamples.copyToWorkspace",
        async (item: SuiExampleItem) => {
          await this.copyToWorkspace(item);
        },
      ),
    );

    // Register command to view example file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "moveWithDizzle.suiExamples.viewFile",
        (item: SuiExampleItem) => {
          this.viewExampleFile(context, item);
        },
      ),
    );

    // Register the view
    context.subscriptions.push(this.treeView);
  }

  /**
   * Refresh the tree view
   */
  public refresh(): void {
    this.examplesProvider.refresh();
  }

  /**
   * View an example file in a new editor tab
   */
  private viewExampleFile(
    context: vscode.ExtensionContext,
    item: SuiExampleItem,
  ): void {
    if (item.contextValue === "file") {
      const filePath = item.resourceUri.fsPath;

      // For Move and other code files, use VS Code's built-in editor
      vscode.workspace.openTextDocument(filePath).then((document) => {
        vscode.window.showTextDocument(document);
      });
    }
  }

  /**
   * Copy an example file or directory to the workspace
   */
  private async copyToWorkspace(item: SuiExampleItem): Promise<void> {
    // Get workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder is open.");
      return;
    }

    // Let user select destination folder if multiple workspace folders
    let targetFolder: vscode.WorkspaceFolder;
    if (workspaceFolders.length === 1) {
      targetFolder = workspaceFolders[0];
    } else {
      const selected = await vscode.window.showQuickPick(
        workspaceFolders.map((folder) => ({
          label: folder.name,
          folder: folder,
        })),
        { placeHolder: "Select a workspace folder" },
      );

      if (!selected) {
        return;
      }

      targetFolder = selected.folder;
    }

    // Get source path
    const sourcePath = item.resourceUri.fsPath;

    // Get file/directory name
    const name = path.basename(sourcePath);

    // Create target path
    const targetPath = path.join(targetFolder.uri.fsPath, name);

    try {
      await this.copyFileOrDirectory(sourcePath, targetPath);
      vscode.window.showInformationMessage(
        `Successfully copied ${name} to workspace.`,
      );

      // Open the copied file if it's a file
      if (item.contextValue === "file") {
        const document = await vscode.workspace.openTextDocument(targetPath);
        await vscode.window.showTextDocument(document);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to copy ${name} to workspace: ${error}`,
      );
    }
  }

  /**
   * Recursive copy function for files or directories
   */
  private async copyFileOrDirectory(
    source: string,
    destination: string,
  ): Promise<void> {
    const stat = fs.statSync(source);

    if (stat.isDirectory()) {
      // Create the destination directory if it doesn't exist
      if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
      }

      // Copy all contents
      const files = fs.readdirSync(source);
      for (const file of files) {
        const srcPath = path.join(source, file);
        const destPath = path.join(destination, file);
        await this.copyFileOrDirectory(srcPath, destPath);
      }
    } else {
      // It's a file, copy directly
      fs.copyFileSync(source, destination);
    }
  }

  /**
   * Shows a quick pick menu to filter examples by category
   */
  public async filterByCategory(): Promise<void> {
    // Get all top-level categories from the examples folder
    const categories = await this.getCategories();

    // Show quick pick with categories
    const selected = await vscode.window.showQuickPick(
      categories.map((category) => ({
        label: this.formatCategoryName(category),
        description: `Browse ${category} examples`,
        category,
      })),
      {
        placeHolder: "Select a category of Sui examples",
        title: "Sui Examples Categories",
      },
    );

    if (selected) {
      // Find the node for this category
      const categoryPath = path.join(
        this.examplesProvider.getRootPath(),
        selected.category,
      );
      const uri = vscode.Uri.file(categoryPath);

      // Reveal the category in the tree view
      this.treeView.reveal(
        new SuiExampleItem(
          selected.category,
          vscode.TreeItemCollapsibleState.Expanded,
          uri,
          "directory",
        ),
        { focus: true, select: true },
      );
    }
  }

  /**
   * Format a category name for display
   */
  private formatCategoryName(category: string): string {
    return category
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Get list of example categories (top-level directories)
   */
  private async getCategories(): Promise<string[]> {
    const rootDir = this.examplesProvider.getRootPath();
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".")) // Skip hidden directories
      .map((entry) => entry.name);
  }
}
