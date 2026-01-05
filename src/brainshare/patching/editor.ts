// editor.ts
import { compare } from "fast-json-patch";
import { CouchDB } from "#src/brainshare/patching/couch.js";
import { BaseDoc, PatchDoc } from "#src/brainshare/patching/types.js";
import { APIs } from "#src/brainshare/service.js";

export class Editor {

  private doc: BaseDoc;

  constructor(private db: CouchDB, private docId: string, data: object) {
    this.doc = {
      _id: docId,
      type: "base",
      version: 0,
      data: data,
    };
  }

  async init(): Promise<void> {
    // await this.db.put<BaseDoc>(this.docId, this.doc);
    const selector =  { type: "patch", stateID: this.docId};
    const version = await this.db.findLastPatch(selector);
    const revision = await this.db.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, this.docId);
    if (revision !== null) {
      this.doc._rev = revision;
      this.doc.version = version;
    }

    await this.db.updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, this.docId, this.doc);

  }

  async applyEdit(preEdit: object, postEdit: object) {
    // base is the JSON value of the neuroglancer state before edit
    // updatedData is the JSON value of the neuroglancer state after edit
    let preEditSorted = deepSortObjectKeys(preEdit);
    let postEditSorted = deepSortObjectKeys(postEdit);
    const patchValue = compare(preEditSorted, postEditSorted);

    if (patchValue.length === 0) {
      console.log("No changes.");
      return;
    }

    const nextVersion = this.doc.version + 1;
    const patchId = `patch:${this.docId}:${String(nextVersion).padStart(9, "0")}`;

    const patchDoc: PatchDoc = {
      _id: patchId,
      type: "patch",
      stateID: this.docId,
      version: nextVersion,
      patch: patchValue,
      timestamp: Date.now(),
    };
    console.log("Computed patchDoc:", patchDoc);
    // save patch
    await this.db.put(patchDoc._id, patchDoc);
    console.log("Saving new patch at:", patchId);
    this.doc.version = nextVersion;
    // update base document version
    //await this.db.upsertCouchState(this.docId, this.doc);
    await this.db.updateCouchStateVersion(this.docId, this.doc);

  }
}

function deepSortObjectKeys<T>(unordered: T): T {
  if (!unordered || typeof unordered !== 'object') {
    return unordered;
  }

  // Handle arrays by sorting their elements recursively
  if (Array.isArray(unordered)) {
    // Optionally sort the array elements if they are comparable
    return unordered.map(deepSortObjectKeys) as unknown as T;
  }

  // Handle objects
  const ordered: Record<string, unknown> = {};
  Object.keys(unordered)
    .sort() // Sort keys alphabetically
    .forEach((key) => {
      // Recursively sort nested values
      ordered[key] = deepSortObjectKeys((unordered as Record<string, unknown>)[key]);
    });

  return ordered as T;
}
