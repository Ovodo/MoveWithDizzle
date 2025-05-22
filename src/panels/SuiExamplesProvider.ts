import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Node representation for the Sui examples tree view
 */
export class SuiExampleItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri: vscode.Uri,
    public readonly contextValue: string = "file",
    public readonly command?: vscode.Command,
  ) {
    super(label, collapsibleState);
    this.resourceUri = resourceUri;
    this.contextValue = contextValue;
    this.command = command;

    // Set icon based on item type
    if (this.contextValue === "directory") {
      this.iconPath = new vscode.ThemeIcon("folder");
    } else {
      // Set file icon based on file extension
      const fileExtension = path.extname(this.label).toLowerCase();
      switch (fileExtension) {
        case ".move":
          this.iconPath = new vscode.ThemeIcon("file-code");
          break;
        case ".toml":
          this.iconPath = new vscode.ThemeIcon("settings");
          break;
        case ".md":
          this.iconPath = new vscode.ThemeIcon("markdown");
          break;
        case ".json":
          this.iconPath = new vscode.ThemeIcon("json");
          break;
        default:
          this.iconPath = new vscode.ThemeIcon("file");
      }
    }

    // Add tooltip with full path
    this.tooltip = this.resourceUri.fsPath;
  }
}

/**
 * Provider for the Sui Examples TreeView
 */
export class SuiExamplesProvider
  implements vscode.TreeDataProvider<SuiExampleItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    SuiExampleItem | undefined | void
  > = new vscode.EventEmitter<SuiExampleItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    SuiExampleItem | undefined | void
  > = this._onDidChangeTreeData.event;

  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the root path of the examples directory
   */
  getRootPath(): string {
    return this.rootPath;
  }

  getTreeItem(element: SuiExampleItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SuiExampleItem): Thenable<SuiExampleItem[]> {
    if (!this.rootPath) {
      vscode.window.showInformationMessage("No Sui examples folder found.");
      return Promise.resolve([]);
    }

    if (element) {
      return this.getExampleItems(element.resourceUri.fsPath);
    } else {
      return this.getExampleItems(this.rootPath);
    }
  }

  /**
   * Get the Sui example items for a given directory path
   */
  private async getExampleItems(
    directoryPath: string,
  ): Promise<SuiExampleItem[]> {
    if (!fs.existsSync(directoryPath)) {
      return [];
    }

    const items: SuiExampleItem[] = [];
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stat = fs.statSync(filePath);
      const fileUri = vscode.Uri.file(filePath);

      if (stat.isDirectory()) {
        items.push(
          new SuiExampleItem(
            file,
            vscode.TreeItemCollapsibleState.Collapsed,
            fileUri,
            "directory",
          ),
        );
      } else {
        // Create a command to open the file when clicked
        const command: vscode.Command = {
          command: "vscode.open",
          title: "Open File",
          arguments: [fileUri],
        };

        items.push(
          new SuiExampleItem(
            file,
            vscode.TreeItemCollapsibleState.None,
            fileUri,
            "file",
            command,
          ),
        );
      }
    }

    // Sort directories first, then files
    items.sort((a, b) => {
      if (a.contextValue === "directory" && b.contextValue === "file") {
        return -1;
      }
      if (a.contextValue === "file" && b.contextValue === "directory") {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });

    return items;
  }
}
