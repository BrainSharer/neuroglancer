// couch.ts
import { AUTHs } from "#src/brainshare/couchdb_store.js";
import { APIs } from "#src/brainshare/service.js";
import { BaseDoc, ChangesFeed, CouchUserDocument, ListenOptions, PatchDoc } from "#src/brainshare/patching/types.js";


// couch.ts
export class CouchDB {
  private baseUrl = APIs.GET_SET_COUCH_STATE;
  public limit: number = 100;
  public base: BaseDoc;

  constructor() { }

  private url(path: string) {
    return `${this.baseUrl}/${path}`;
  }

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

  async put<T>(id: string, body: T): Promise<void> {
    const url = `${this.baseUrl}/${id}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    // return response.json();
  }

  async post<T>(body: T): Promise<void> {
    const response = await fetch(this.url(""), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  async queryByPrefix(prefix: string): Promise<any[]> {
    const url = `${this.baseUrl}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}\ufff0"`;
    const response = await fetch(url,
      { headers: this.headers() }
    );
    const json = await response.json();

    if (!response.ok) throw new Error(await response.text());

    return json.rows.map((r: any) => r.doc);
  }

  async find(selector: any): Promise<any[]> {
    console.log("CouchDB find selector:", selector);
    const url = this.baseUrl + "/_find";
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      
    });
    const json = await response.json();
    return json.docs;
  }

async findLatestPatches(selector: any): Promise<PatchDoc[]> {
  const response = await fetch(`${this.baseUrl}/_find`, {
    method: "POST",
    headers: this.headers(),
    body: JSON.stringify({
      selector: {
        ...selector,
        timestamp: { "$exists": true }
      },
      sort: [{ timestamp: "desc" }],
      limit: this.limit,
      use_index: "timestamp-index"
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CouchDB query failed: ${text}`);
  }

  const data = await response.json();
  return data.docs;
}


  async findLastPatch(selector: any): Promise<number> {
    console.log("CouchDB find lastest patch selector:", selector);
    const url = this.baseUrl + "/_find";
    const fieldName = "version";
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        selector: {
          ...selector,
          timestamp: { "$exists": true }
        },
        sort: [{ timestamp: "desc" }],
        limit: this.limit,
        fields: [fieldName],
        use_index: "timestamp-index"
      }),
    });

    if (!response.ok) {
      throw new Error(`CouchDB error: ${response.statusText}`);
    }

    let latestVersion = 1;
    const data = await response.json();
    if (!data.docs || data.docs.length === 0) {
      console.log("No patches found, starting from version 1.");
      return latestVersion; // start from 1 if no documents exist
    }

    const maxValue = data.docs.reduce((max: number, doc: { [x: string]: any; }) => {
      const value = Number(doc[fieldName]);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);

    return maxValue + 1;
  }

  async changes(since: string | number, filter?: string) {
    const url = new URL(this.baseUrl + "/_changes");
    url.searchParams.set("feed", "longpoll");
    url.searchParams.set("since", since.toString());
    url.searchParams.set("include_docs", "true");
    url.searchParams.set("limit", this.limit.toString());
    if (filter) url.searchParams.set("filter", filter);

    const response = await fetch(url.toString(), {
      headers: this.headers(),
    });

    if (!response.ok) throw new Error(await response.text());

    return response.json();
  }

  /** putting static methods into the class */
  async updateCouchStateVersion(stateID: string, couchState: BaseDoc): Promise<BaseDoc> {
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
    if (revision !== null) {
      couchState._rev = revision;
    }
    const newDoc: BaseDoc = await this.updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, stateID, couchState);
    return newDoc;
  }

  async upsertCouchState(stateID: string, state: object) {
    if (typeof state === 'object' && state !== null && 'position' in state && 'selectedLayer' in state) {
      console.debug("Upserting the State interface structure");
    } else {
      console.error("state is not a neuroglancer json");
      console.error(state);
      return;
    }
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
    let couchState: BaseDoc = { _id: stateID, "type": "base", "version": 0, "data": state };
    if (revision !== null) {
      couchState = { _id: stateID, _rev: revision, "type": "base", "version": 0, "data": state };
    }
    this.base = couchState;
    this.updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, stateID, couchState);
  }

  async getRevisionFromChangesFeed(dbUrl: string, docId: string): Promise<string | null> {
    const changesUrl = `${dbUrl}/_changes?filter=_doc_ids&include_docs=false&descending=false`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;

    console.debug("Fetching changes from CouchDB:", changesUrl);

    const response = await fetch(changesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ doc_ids: [docId] }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch _changes: ${response.statusText}`);
    }

    const data: ChangesFeed = await response.json();
    const change = data.results.find(change => change.id === docId);
    return change?.changes[0]?.rev || null;
  }

  async fetchStateDocument(stateID: string): Promise<BaseDoc | null> {
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
    if (revision === null) {
      console.error("No state found when looking for revision");
      return null;
    } else {
      console.debug('found state revision', revision);
    }
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;

    try {
      const response = await fetch(APIs.GET_SET_COUCH_STATE + "/" + parseInt(stateID), {
        method: "GET",
        headers,
      });
      const data: BaseDoc = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching CouchDB state document:', error);
      return null;
    }

  }

  /** Generic couch DB methods */

  async updateCouchDBDocument<T>(dbUrl: string, _id: string, updatedDoc: T): Promise<T> {
    if (!_id) {
      throw new Error("Document must have _id ");
    }
    const url = `${dbUrl}/${encodeURIComponent(_id)}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;

    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(updatedDoc),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update document: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  listenToDocumentChanges(options: ListenOptions) {
    const { dbUrl, docId, since = 'now', onChange, onError } = options;
    const url = new URL(`${dbUrl}/_changes`);
    url.searchParams.append('feed', 'continuous');
    url.searchParams.append('include_docs', 'true');
    url.searchParams.append('filter', '_doc_ids');
    url.searchParams.append('since', since);
    url.searchParams.append('heartbeat', '10000');

    const controller = new AbortController();
    const signal = controller.signal;
    const body = JSON.stringify({ doc_ids: [docId] });

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;


    const fetchOptions: RequestInit = {
      method: docId ? 'POST' : 'GET',
      headers,
      body,
      signal,
    };


    (async () => {
      try {
        const response = await fetch(url, fetchOptions);

        console.debug("Listening to CouchDB changes url:", url.toString());

        if (!response.ok || !response.body) {
          throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line) {
              try {
                const json = JSON.parse(line);
                onChange(json);
              } catch (err) {
                if (onError) onError(err);
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          if (onError) onError(err);
        }
      }
    })();

    return {
      stop: () => controller.abort(),
    };
  }

  async fetchUserDocument(stateID: string): Promise<CouchUserDocument | null> {
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
    if (revision === null) {
      return null;
    }
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers["Authorization"] = `Basic ${credentials}`;
    const response = await fetch(APIs.GET_SET_COUCH_USER + "/" + parseInt(stateID), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      console.error('Error fetching CouchDB user document:', response.statusText);
      return null;
    }
    const data: CouchUserDocument = await response.json();
    return data;
  }


  async upsertCouchUser(stateID: string, users: any) {
    console.debug("method upsertCouchUser with ID: " + stateID + " and users: ", users);
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
    let couchState: CouchUserDocument = { _id: stateID, users };
    if (revision !== null) {
      couchState = { _id: stateID, _rev: revision, users };
    }
    await this.updateCouchDBDocument(APIs.GET_SET_COUCH_USER, stateID, couchState);
  }



} // end class
