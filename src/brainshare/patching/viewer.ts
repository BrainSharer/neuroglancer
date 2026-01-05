// viewer.ts
import { applyPatch } from "fast-json-patch";
import { CouchDB } from "#src/brainshare/patching/couch.js";
import { BaseDoc, PatchDoc } from "#src/brainshare/patching/types.js";

export class Viewer {
  
  private baseDoc!: BaseDoc;
  private since: string | number = "now";
  private docId: string = "";
  private running: boolean = false;

  constructor(private db: CouchDB) {}


  async initialize(id: string): Promise<BaseDoc> {
    this.docId = id;
    this.baseDoc = await this.db.get<BaseDoc>(id);
    this.running = true;
    

    const patches = await this.db.findLatestPatches({
      type: "patch",
      stateID: id,
      version: this.baseDoc.version
    });

    if (patches === undefined) {
      console.log("No patches found.");
    } else {
      console.log(`Found ${patches.length} patches.`);
    }

    patches
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((p: PatchDoc) => {
        console.log("Applying patch:", p.version);
        applyPatch(this.baseDoc.data, p.patch);
      });
    
    return this.baseDoc;
  }

  async listen(onUpdate: (baseDoc: BaseDoc) => void) {
    while (this.running) {
      const result = await this.db.changes(this.since);

      console.log("Changes result length:", result.results.length );

      this.since = result.last_seq;

      for (const row of result.results) {
        const p = row.doc as PatchDoc;

        // need to restrict this more
        if ((p?.type === "patch") && (p.stateID === this.docId)) {
          console.log("Applying listen patch:", p.version);
          try {
            applyPatch(this.baseDoc.data, p.patch);
          } catch (error) {
            console.error("Error applying patch:", error);
          }
          this.baseDoc.version = p.version;          
          onUpdate(this.baseDoc);
        }
      }
    }
  }

  stop() {
    this.running = false;
  }

}
