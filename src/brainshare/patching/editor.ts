// editor.ts
import { compare } from "fast-json-patch";
import { CouchDB } from "#src/brainshare/patching/couch.js";
import { BaseDoc, PatchDoc } from "#src/brainshare/patching/types.js";

export class Editor {
  constructor(private db: CouchDB) {}

  async loadBase(stateID: string): Promise<BaseDoc> {
    return this.db.get<BaseDoc>(stateID);
  }

  async applyEdit(stateID: string, version: number, base: any, updatedData: any) {
    // const base = await this.loadBase(stateID);

    const patch = compare(base, updatedData);

    if (patch.length === 0) {
      console.log("No changes.");
      return;
    }

    const patchId = `patch:${stateID}:${String(version + 1).padStart(8, "0")}`;
    console.log("Creating patch:", patchId);

    const patchDoc: PatchDoc = {
      _id: patchId,
      type: "patch",
      baseVersion: version,
      patch,
      timestamp: Date.now(),
    };

    console.log("Patch doc:", patchDoc);

    // Save patch
    await this.db.put(patchId, patchDoc);

    // Update base version (not data)
    /**
    await this.db.put(base._id, {
      ...base,
      version: version + 1,
    });
    */

    console.log("Patch saved:", patchId);
  }
}
