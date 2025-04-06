import * as vscode from "vscode";
import { PackageInfo, SuiModule, SuiObject } from "../utils/fetchPackageInfo";

export class PackageNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }
}

export class PackageTreeProvider
  implements vscode.TreeDataProvider<PackageNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<PackageNode | undefined> =
    new vscode.EventEmitter<PackageNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<PackageNode | undefined> =
    this._onDidChangeTreeData.event;

  private packageInfo: PackageInfo | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(packageInfo: PackageInfo) {
    this.packageInfo = packageInfo;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: PackageNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PackageNode): Thenable<PackageNode[]> {
    if (!this.packageInfo) {
      return Promise.resolve([]);
    }

    if (!element) {
      const pkgNode = new PackageNode(
        `📦 Package: ${this.packageInfo.packageId}`,
        vscode.TreeItemCollapsibleState.Expanded,
        "package"
      );
      return Promise.resolve([pkgNode]);
    }

    if (element.contextValue === "package") {
      const modulesNode = new PackageNode(
        "📁 Modules",
        vscode.TreeItemCollapsibleState.Collapsed,
        "modulesGroup"
      );
      const objectsNode = new PackageNode(
        "🧱 Objects",
        vscode.TreeItemCollapsibleState.Collapsed,
        "objectsGroup"
      );
      return Promise.resolve([modulesNode, objectsNode]);
    }

    if (element.contextValue === "modulesGroup") {
      return Promise.resolve(
        this.packageInfo.modules.map(
          (mod) =>
            new PackageNode(
              mod.name,
              vscode.TreeItemCollapsibleState.Collapsed,
              "module"
            )
        )
      );
    }

    if (element.contextValue === "module") {
      const mod = this.packageInfo.modules.find(
        (m) => m.name === element.label
      );
      return Promise.resolve(
        mod?.functions.map(
          (fn) =>
            new PackageNode(
              `🛠️ ${fn}`,
              vscode.TreeItemCollapsibleState.None,
              "function"
            )
        ) || []
      );
    }

    if (element.contextValue === "objectsGroup") {
      return Promise.resolve(
        this.packageInfo.objects.map(
          (obj) =>
            new PackageNode(
              `🔹 ${obj.objectId} (${obj.type})`,
              vscode.TreeItemCollapsibleState.None,
              "object"
            )
        )
      );
    }

    return Promise.resolve([]);
  }
}
