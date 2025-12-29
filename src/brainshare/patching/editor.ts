// editor.ts
import { CouchClient } from "#src/brainshare/patching/couch.js";
import { createPatch } from "#src/brainshare/patching/patch.js";
import { State } from "#src/brainshare/state_utils.js";

export class Editor {
  private state: State;
  private version: number;
  private stateID: string;

  constructor(private couch: CouchClient) {}

  async init() {
    this.stateID = this.couch["stateID"];
    const snapshot = await this.couch.get<any>(this.stateID);
    this.state = snapshot.state;
    this.version = snapshot.version;
    console.log("Initialized editor with state:", this.state);
    console.log("Initialized editor with stateID:", this.stateID);
  }

  async applyLocalEdit(mutator: (draft: any) => void) {
    const nextState = structuredClone(this.state);
    mutator(nextState);
    const patch = createPatch(this.state, nextState);
    console.log("Generated patch", patch);
    if ((patch.length === 0) || (this.stateID === undefined)) return;

    this.version += 1;
    

    console.log("New version after patch", this.version);

    this.couch.postPatch({
         _id: `patch:${this.stateID}:${String(this.version).padStart(6, "0")}`,
        type: "patch",
        baseVersion: this.version - 1,
        targetVersion: this.version,
        createdAt: new Date().toISOString(),
        patch: patch,
      });

    this.state = nextState;
  }
}
