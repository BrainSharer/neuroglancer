// couch.ts
import { AUTHs} from "#src/brainshare/couchdb_store.js";
import { APIs } from "#src/brainshare/service.js";

export class CouchClient {
  constructor(
    private baseUrl: string,
    private dbName: string,
    private stateID: string
  ) {}

  private createHeaders() {
    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    return {
      "Content-Type": "application/json",
      "Authorization": `Basic ${credentials}`,
    };
}

  private url(path: string) {
    return `${this.baseUrl}/${this.dbName}/${path}`;
  }

  async get<T>(id: string): Promise<T | null> {
    if (!id) return null;
    // const stateID = "0"; // Assuming the snapshot document has ID "0"
    const response = await fetch(this.url(encodeURIComponent(id)), {
      method: "GET",
      headers: this.createHeaders(),
    });

    if (response.status === 404) {
        // Handle "not found" gracefully
        return null;
      }

    if (!response.ok) {
      throw new Error(`Failed to get document: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async put<T>(id: string, body: T): Promise<void> {
    const res = await fetch(this.url(encodeURIComponent(id)), {
      method: "PUT",
      headers: this.createHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async post<T>(body: T): Promise<void> {
    const res = await fetch(this.url(""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async postPatch<T>(body: T): Promise<void> {
    const response = await fetch(APIs.GET_SET_COUCH_STATE, {
      method: "POST",
      headers: this.createHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
  }


  async changes(since: string | number, onChange: (doc: any) => void) {
    const url = `${this.url("_changes")}?feed=longpoll&include_docs=true&since=${since}`
    console.log("CouchDB changes URL:", url);
    const response = await fetch(url, {
      method: "GET",
      headers: this.createHeaders(),
    });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch changes: ${response.status} ${errorText}`);
  }


    const data = await response.json();
    console.log("CouchDB changes response data:", data);
    for (const row of data.results) {
      if (row.doc) onChange(row.doc);
    }
    return data.last_seq;
  }
}
