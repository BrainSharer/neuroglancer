// editor.ts
import { CouchClient } from "#src/brainshare/patching/couch.js";
import { createPatch } from "#src/brainshare/patching/patch.js";
import { State } from "#src/brainshare/state_utils.js";

export class Editor {
  private state: any;
  private version: number;
  private stateID: string;

  constructor(private couch: CouchClient) {}

  async init() {
    const snapshot = await this.couch.get<any>();
    this.state = snapshot.state;
    this.version = snapshot.version;
    this.stateID = snapshot._id;
  }

  applyLocalEdit(mutator: (draft: State) => void) {
    const nextState = structuredClone(this.state);
    mutator(nextState);
    const patch = createPatch(this.state, nextState);
    console.log("Generated patch", patch);
    if (patch.length === 0) return;

    this.version += 1;
    console.log("New version after patch", this.version);
    const json_body = {
      _id: `patch:${String(this.stateID)}:${String(this.version).padStart(6, "0")}`,
      type: "patch",
      baseVersion: this.version - 1,
      targetVersion: this.version,
      patch,
      createdAt: new Date().toISOString(),
    }
    console.log("Posting patch to CouchDB", json_body);

    this.couch.postPatch({json_body});

    this.state = nextState;
  }
}
