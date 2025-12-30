// viewer.ts
import { applyPatch } from "fast-json-patch";
import { CouchDB } from "#src/brainshare/patching/couch.js";
import { BaseDoc, PatchDoc } from "#src/brainshare/patching/types.js";

export class Viewer {
  
  private state: BaseDoc;
  private since: string | number = "now";
  private docId: string = "";

  constructor(private db: CouchDB) {}

  async getDocument(id: string): Promise<any> {
    const base = await this.db.get<BaseDoc>(id);

    const patches = await this.db.queryByPrefix("patch:" + id);
    console.log("Found patches #", patches.length);

    const sortedPatches = patches
      .filter((p: PatchDoc) => p.baseVersion >= base.version)
      .sort((a: PatchDoc, b: PatchDoc) => a.baseVersion - b.baseVersion);

    let doc = structuredClone(base.data);

    for (const p of sortedPatches) {
      doc = applyPatch(doc, p.patch, true, false).newDocument;
    }

    return doc;
  }

  async initialize(id: string): Promise<any> {
    this.docId = id;
    const base = await this.db.get<BaseDoc>(id);
    this.state = structuredClone(base.data);

    const patches = await this.db.find({
      type: "patch",
      baseVersion: { "$gte": base.version }
    });

    if (patches === undefined) {
      console.log("No patches found.");
      return this.state;
    }

    patches
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach(p => applyPatch(this.state, p.patch));

    return this.state;
  }

  async listen(onUpdate: (doc: BaseDoc) => void) {
    while (true) {
      const result = await this.db.changes(this.since);
      console.log("Changes result:", result);

      this.since = result.last_seq;

      for (const row of result.results) {
        console.log("Change row:", row);
        const doc = row.doc as PatchDoc;
        console.log("Change doc type:", doc.type);
        console.log("Change doc doc._id:", doc._id);
        console.log("Change doc this.docId:", this.docId);

        // need to restrict this more
        if (doc?.type === "patch") {
          applyPatch(this.state, doc.patch);
          this.state.version = doc.baseVersion;
          onUpdate(this.state);
        }
      }
    }
  }

}
