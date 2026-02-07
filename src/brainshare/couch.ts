// couch.ts
import { AUTHs } from "#src/brainshare/couchdb_store.js";
import { APIs } from "#src/brainshare/service.js";
import { BaseDoc, ChangesFeed, CouchUserDocument, ListenOptions } from "#src/brainshare/types.js";


// couch.ts
export class CouchDB {
  private baseUrl = APIs.GET_SET_COUCH_STATE;

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

  public async get<T>(id: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${id}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  public async put<T>(id: string, body: T): Promise<void> {
    const url = `${this.baseUrl}/${id}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    // return response.json();
  }

  public async post<T>(body: T): Promise<void> {
    const response = await fetch(this.url(""), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
  }


  public async upsertCouchStateXXX(stateID: string, state: object): Promise<void> {
    if (typeof state === 'object' && state !== null && 'position' in state && 'selectedLayer' in state) {
      console.debug("Upserting the State interface structure");
    } else {
      console.error("state is not a neuroglancer json");
      console.error(state);
    }
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
    let couchState: BaseDoc = { _id: stateID, "type": "base", "version": 0, "data": state };
    if (revision !== null) {
      couchState = { _id: stateID, _rev: revision, "type": "base", "version": 0, "data": state };
    }
    this.updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, stateID, couchState);
  }

  public async upsertCouchState(stateID: string, state: object): Promise<void> {
    let attempt = 0;
    const retries = 5;
    const delayMs = 10;
    const url = `${this.baseUrl}/${encodeURIComponent(stateID)}`;

    while (attempt <= retries) {
      attempt++
      let revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
      let updatedDoc: BaseDoc = { _id: stateID, "type": "base", "version": 0, "data": state };
      if (revision !== null) {
        updatedDoc = { _id: stateID, _rev: revision, "type": "base", "version": 0, "data": state };
      } else {
        return;
      }

      const putRes = await fetch(url, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(updatedDoc),
      })

      if (putRes.ok) {
        return;
      }

      // 4. Handle conflict
      if (putRes.status === 409 && attempt <= retries) {
        await sleep(delayMs * attempt) // simple backoff
        continue
      }

    }
    console.warn("Exceeded maximum retry attempts to upsert CouchDB state.");
  }

  private async getRevisionFromChangesFeed(dbUrl: string, docId: string): Promise<string | null> {
    const changesUrl = `${dbUrl}/_changes?filter=_doc_ids&include_docs=false&descending=false`;

    const response = await fetch(changesUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ doc_ids: [docId] }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch _changes: ${response.statusText}`);
    }

    const data: ChangesFeed = await response.json();
    const change = data.results.find((change: { id: string; }) => change.id === docId);
    return change?.changes[0]?.rev || null;
  }

  public async fetchStateDocument(stateID: string): Promise<BaseDoc | null> {
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
    if (revision === null) {
      console.error("No state found when looking for revision");
      return null;
    } else {
      console.debug('found state revision', revision);
    }

    try {
      const response = await fetch(APIs.GET_SET_COUCH_STATE + "/" + parseInt(stateID), {
        method: "GET",
        headers: this.headers(),
      });
      const data: BaseDoc = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching CouchDB state document:', error);
      return null;
    }

  }

  /** Generic couch DB methods */

  private async updateCouchDBDocument<T>(dbUrl: string, _id: string, updatedDoc: T): Promise<void> {
    if (!_id) {
      throw new Error("Document must have _id ");
    }
    const url = `${dbUrl}/${encodeURIComponent(_id)}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(updatedDoc),
    });

    if (response.ok) {
      console.debug(`Successfully updated document with _id: ${_id}`);
      return;
    }

    if (!response.ok) {
      // Check for the specific 409 status code
      if (response.status === 409) {
        console.warn('Conflict error (409):');
        // Handle the conflict (e.g., inform the user the resource already exists)
      } else {
        const errorText = await response.text();
        throw new Error(`Failed to update document: ${response.status} ${response.statusText} - ${errorText}`);
      }

    }


  }

  public listenToDocumentChanges(options: ListenOptions) {
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


    const fetchOptions: RequestInit = {
      method: docId ? 'POST' : 'GET',
      headers: this.headers(),
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

  public async fetchUserDocument(stateID: string): Promise<CouchUserDocument | null> {
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
    if (revision === null) {
      return null;
    }

    const response = await fetch(APIs.GET_SET_COUCH_USER + "/" + parseInt(stateID), {
      method: "GET",
      headers: this.headers(),
    });

    if (!response.ok) {
      console.error('Error fetching CouchDB user document:', response.statusText);
      return null;
    }
    const data: CouchUserDocument = await response.json();
    return data;
  }


  public async upsertCouchUser(stateID: string, users: any) {
    console.debug("method upsertCouchUser with ID: " + stateID + " and users: ", users);
    const revision = await this.getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
    let couchUsers: CouchUserDocument = { _id: stateID, users };
    if (revision !== null) {
      couchUsers = { _id: stateID, _rev: revision, users };
    }
    await this.updateCouchDBDocument(APIs.GET_SET_COUCH_USER, stateID, couchUsers);
  }


} // end class


export function objectsAreEqual(obj1: any, obj2: any): boolean {
    // Check for strict equality (handles primitives, null, undefined)
    if (obj1 === obj2) return true;

    // Check if both are objects and not null
    if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
        return false;
    }

    // Handle arrays
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) return false;
        for (let i = 0; i < obj1.length; i++) {
            if (!objectsAreEqual(obj1[i], obj2[i])) return false;
        }
        return true;
    } else if (Array.isArray(obj1) || Array.isArray(obj2)) {
        return false; // One is an array, the other isn't
    }

    // Handle regular objects
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key) || !objectsAreEqual(obj1[key], obj2[key])) {
            return false;
        }
    }

    return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

