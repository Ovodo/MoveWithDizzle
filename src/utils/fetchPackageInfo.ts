import { exec } from "child_process";
import * as util from "util";
const execAsync = util.promisify(exec);

export interface SuiModule {
  name: string;
  functions: string[];
}

export interface SuiObject {
  objectId: string;
  type: string;
}

export interface PackageInfo {
  packageId: string;
  modules: SuiModule[];
  objects: SuiObject[];
}

export async function fetchPackageInfo(
  packageId: string
): Promise<PackageInfo> {
  const modules: SuiModule[] = [];
  const objects: SuiObject[] = [];

  // Get module metadata
  const id =
    "0x44809c47381e8f8929e2ba8720fae6343e9138fbc93ded45e26bdce04c944e0e";
  try {
    const { stdout } = await execAsync(
      `sui client objects ${packageId} --json`
    );
    const parsed = JSON.parse(stdout);

    for (const mod of parsed.modules || []) {
      modules.push({
        name: mod.name,
        functions: mod.exposed_functions?.map((f: any) => f.name) || [],
      });
    }
  } catch (e) {
    console.error("Error fetching module info:", e);
  }

  // Get related objects (owned by you or created by this package)
  try {
    const { stdout } = await execAsync(`sui client objects --json`);
    const parsed = JSON.parse(stdout);

    for (const obj of parsed.data || []) {
      if (
        obj.owner?.AddressOwner ||
        obj.type?.includes(packageId.replace("0x", ""))
      ) {
        objects.push({
          objectId: obj.objectId,
          type: obj.type,
        });
      }
    }
  } catch (e) {
    console.error("Error fetching objects:", e);
  }

  return { packageId, modules, objects };
}
