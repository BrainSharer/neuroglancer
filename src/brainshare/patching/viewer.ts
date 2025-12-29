// viewer.ts
import { CouchClient } from "#src/brainshare/patching/couch.js";
import { applyPatches } from "#src/brainshare/patching/patch.js";

export class Viewer {
  private state: any;
  private version: number;
  private seq: string | number = 0;

  constructor(
    private couch: CouchClient,
    private onUpdate: (state: any) => void
  ) {}

  async init() {
    const snapshot = await this.couch.get<any>("doc:main");
    this.state = snapshot.data;
    this.version = snapshot.version;
    this.onUpdate(this.state);
    console.log("Initialized viewer with snapshot:", this.state);

    await this.catchUp();
    this.listen();
  }

  private async catchUp() {
    const headers = this.couch["createHeaders"]();
    console.log("Fetching all docs for catch-up with headers:", headers);
    const res = await fetch(
      `${this.couch["baseUrl"]}/${this.couch["dbName"]}/_all_docs?include_docs=true`, { headers }
    );
    const data = await res.json();
    console.log("Fetched all docs for catch-up:", data);

    const patches = data.rows
      .map((r: any) => r.doc)
      .filter(
        (d: any) =>
          d?.type === "patch" && d.baseVersion >= this.version
      )
      .sort((a: any, b: any) => a.targetVersion - b.targetVersion);

    for (const p of patches) {
      this.state = applyPatches(this.state, p.patch);
      this.version = p.targetVersion;
      this.onUpdate(this.state);
    }
  }

  private async listen() {
    while (true) {
      this.seq = await this.couch.changes(this.seq, (doc) => {
        if (doc.type === "patch" && doc.baseVersion === this.version) {
          this.state = applyPatches(this.state, doc.patch);
          this.version = doc.targetVersion;
          this.onUpdate(this.state);
        }
      });
    }
  }
}
