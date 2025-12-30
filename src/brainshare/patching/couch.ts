// couch.ts
import { AUTHs } from "#src/brainshare/couchdb_store.js";
import { APIs } from "#src/brainshare/service.js";


// couch.ts
export class CouchDB {
  private baseUrl = APIs.GET_SET_COUCH_STATE;

  constructor() { }

  private headers() {
    let headers: any = { "Content-Type": "application/json" };
    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;
    return headers;
  }

  async get<T>(id: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${id}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async put<T>(id: string, body: T): Promise<T> {
    const url = `${this.baseUrl}/${id}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async queryByPrefix(prefix: string): Promise<any[]> {
    const url = `${this.baseUrl}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}\ufff0"`;
    const res = await fetch(url,
      { headers: this.headers() }
    );
    const json = await res.json();

    if (!res.ok) throw new Error(await res.text());

    return json.rows.map((r: any) => r.doc);
  }

  async find(selector: any): Promise<any[]> {
    console.log("CouchDB find selector:", selector);
    const url = this.baseUrl + "/_find";
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ selector }),
    });
    const json = await res.json();
    return json.docs;
  }

  async changes(since: string | number, filter?: string) {
    // const url = new URL(this.baseUrl("_changes"));
    const url = new URL(this.baseUrl + "/_changes");
    url.searchParams.set("feed", "longpoll");
    url.searchParams.set("since", since.toString());
    url.searchParams.set("include_docs", "true");
    if (filter) url.searchParams.set("filter", filter);

    const res = await fetch(url.toString(), {
      headers: this.headers(),
    });
    
    if (!res.ok) throw new Error(await res.text());
    
    return res.json();
  }
  

}
