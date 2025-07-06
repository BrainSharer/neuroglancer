import { getCookie } from "typescript-cookie";
import { fetchOk } from "#src/util/http_request.js";
import { StatusMessage } from "#src/status.js";
import { WatchableValue } from "#src/trackable_value.js";
import { APIs } from "#src/brainshare/service.js";
import { AUTHs} from "#src/brainshare/couchdb_store.js";

interface ChangeResult {
  seq: string;
  id: string;
  changes: { rev: string }[];
  deleted?: boolean;
}

interface ChangesFeed {
  results: ChangeResult[];
  last_seq: string;
  pending: number;
}

export interface CouchUserDocument {
  _id: string;          // Unique document ID
  _rev?: string;        // Revision token, optional for new docs
  _deleted?: boolean;   // If true, marks the document as deleted
  users: any;
}

export interface CouchStateDocument {
  _id: string;          // Unique document ID
  _rev?: string;        // Revision token, optional for new docs
  _deleted?: boolean;   // If true, marks the document as deleted
  state: Object;
}

interface CouchDbChange {
  seq: string;
  id: string;
  changes: { rev: string }[];
  deleted?: boolean;
  doc?: any; // This needs to be very generic
}

interface ListenOptions {
  dbUrl: string;
  docId: string;
  since?: string; // Optional: start listening from a specific sequence
  onChange: (change: CouchDbChange) => void;
  onError?: (error: any) => void;
}

export interface State {
  id: number;
  user: string;
  owner: number;
  animal: string;
  comments: string;
  neuroglancer_state: object;
  readonly: boolean;
  public: boolean;
  lab: string;
}

export interface User {
  id: number;
  username: string;
  lab: string;
  access: string;
}

export interface UrlParams {
  "stateID": string | null,
}

/**
 * This function gets the two parameters from the URL
 * 1. The id which is the primary key in the neuroglancer state table
 * 2. multi which is a boolean saying if we are in multi user mode or not.
 * @returns a JSON dictionary of the two variables
 */
export function getUrlParams(): any {
  const href = new URL(location.href);
  const stateID = href.searchParams.get("id");
  // const loaded = Boolean(Number(href.searchParams.get("loaded")));
  const locationVariables = { stateID };
  return locationVariables;
}

/**
 * username and id are both cookies
 * If the user_id (id) cookie exists, use it, otherwise set to 0
 * If the username cookie exists, use it, otherwise set to an empty string
 * @returns json of user
 */
export function getUser() {
  const id = getCookie("id") ?? 0;
  const username = getCookie("username") ?? "";
  const lab = getCookie("lab") ?? "";
  const access = getCookie("access") ?? "";

  let userjson = { "id": 0, "username": "", "lab": "", "access": "" };
  if ((id !== 0) && (username !== "")) {
    userjson = {
      "id": +id,
      "username": username,
      "lab": lab,
      "access": access
    };
  }

  userState.value = userjson;
}

/**
 * No authentication/authorization is required to get data
 * @param stateID The integer from the REST API of the neuroglancer_state id.
 * @returns the JSON state
 */
export function getState(
  stateID: number | string | undefined
): Promise<void> | undefined {
  if (stateID === undefined) return;

  return fetchOk(APIs.GET_SET_STATE + stateID, { method: "GET" }).then(
    response => response.json()
  ).then(json => {
    brainState.value = json;
    console.debug("brainState", brainState.value);
  }).catch(err => {
    console.error(err);
    StatusMessage.showTemporaryMessage(
      "The brain ID is not in the database. Please check again."
    );
    brainState.value = {
      id: 0,
      user: "",
      owner: 0,
      animal: "",
      comments: err,
      neuroglancer_state: {},
      readonly: false,
      public: false,
      lab: "NA",
    };
  })
}

/**
 * Creates a new neuroglancer_state in the database via a REST POST
 * Authorization should be required, but hasn't been implemented yet.
 * @param state the JSON state
 * @returns the JSON state
 */
export function newState(state: Object) {
  const json_body = { ...brainState.value, ...state }
  console.debug("newState", json_body);
  const access = getCookie("access") ?? "";

  fetchOk(APIs.GET_SET_STATE, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${access}`,
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(
    response => response.json()
  ).then(json => {
    const href = new URL(location.href);
    href.searchParams.set("id", json["id"]);
    window.history.pushState({}, "", href.toString());
    brainState.value = json;
    StatusMessage.showTemporaryMessage("A new state has been created.", 10000);
  }).catch(Error => {
    console.error('Error creating new data to DB:', Error);
    StatusMessage.showTemporaryMessage("Error: the current neuroglancer state has NOT been created.", 10000);
    return null;
  });
}

/**
 * This saves the data in the DB via a REST PUT
 * @param stateID  The integer from the REST API of the neuroglancer_state id
 * @param state the JSON state
 * @returns the JSON state
 */
export function saveState(stateID: number | string, state: Object) {
  const json_body = { ...brainState.value, ...state }
  console.debug("saveState", json_body);
  const access = getCookie("access") ?? "";

  fetchOk(APIs.GET_SET_STATE + stateID, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${access}`,
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer state has been saved.", 10000);
  }).catch(Error => {
    console.error('Error saving data to DB:', Error);
    StatusMessage.showTemporaryMessage("Error: the current neuroglancer state has NOT been saved.", 10000);
    return null;
  });
}

/** End mysql REST api methods */

/** Start CouchDB methods
 * Couch user methods
 */

export async function fetchUserDocument(stateID: string): Promise<CouchUserDocument | null> {
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
  if (revision === null) {
    console.error("No user found when looking for revision");
    return null;
  } else {
    console.debug('found user revision', revision);
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
  StatusMessage.showTemporaryMessage("A couch user data has been fetched." + data._rev, 10000);
  return data;
}


export async function upsertCouchUser(stateID: string, users: any) {
  console.debug("method upsertCouchUser with ID: " + stateID + " and users: ", users);
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
  let couchState: CouchUserDocument = {_id: stateID, users };
  if (revision !== null) { 
    couchState = {_id: stateID, _rev: revision, users };
  }
  updateCouchDBDocument(APIs.GET_SET_COUCH_USER, stateID, couchState);
}


/**
 * Couch state methods
 */

export async function fetchStateDocument(stateID: string): Promise<CouchStateDocument | null> {
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
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
    const data: CouchStateDocument = await response.json();
    StatusMessage.showTemporaryMessage("A couch state has been fetched." + data._rev, 10000);
    return data;
  } catch (error) {
    console.error('Error fetching CouchDB state document:', error);
    return null;
  }
}
export async function upsertCouchState(stateID: string, state: Object) {
  if (typeof state === 'object' && state !== null && 'position' in state && 'selectedLayer' in state) {
    console.debug("Upserting the State interface structure");
  } else {
    console.error("state does NOT match the State interface structure");
    return;
  }
  
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
  let couchState: CouchStateDocument = {_id: stateID, "state": state };
  if (revision !== null) { 
    couchState = {_id: stateID, _rev: revision, "state": state };
  }
  updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, stateID, couchState);
}


/** Generic couch DB methods */

async function updateCouchDBDocument<T>(
  dbUrl: string,
  _id: string,
  updatedDoc: T
): Promise<T> {


  if (!_id) {
    throw new Error("Document must have _id ");
  }
  const url = `${dbUrl}/${encodeURIComponent( _id)}`;

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


export async function getRevisionFromChangesFeed(dbUrl: string, docId: string): Promise<string | null> {
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


export function listenToDocumentChanges(options: ListenOptions) {
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
      const res = await fetch(url, fetchOptions);

      console.debug("Listening to CouchDB changes url:", url.toString());

      if (!res.ok || !res.body) {
        throw new Error(`Fetch error: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
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

/** class for listening to couchdb document changes */
type CouchDBListenerOptions = {
  dbUrl: string;
  docId: string;
  since?: string; // For resuming changes
  onChange: (doc: any) => void;
  onError?: (err: any) => void;
};

export class CouchDBDocumentListener {
  private controller: AbortController;
  private running: boolean = false;

  constructor(private options: CouchDBListenerOptions) {
    this.controller = new AbortController();
  }

  public async start() {
    if (this.running) return;

    this.running = true;
    const { dbUrl, docId, since, onChange, onError } = this.options;

    const url = new URL(`${dbUrl}/_changes`);
    url.searchParams.append('feed', 'continuous');
    url.searchParams.append('include_docs', 'true');
    url.searchParams.append('filter', '_doc_ids');
    url.searchParams.append('since', since || 'now');
    url.searchParams.append('heartbeat', '10000');

    const headers = new Headers();
    const credentials = btoa(`${AUTHs.USER}:${AUTHs.PASSWORD}`);
    headers.append('Authorization', `Basic ${credentials}`);
    headers.append('Content-Type', 'application/json');

    console.debug("Listening to CouchDB changes url:", url);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ doc_ids: [docId] }),
        signal: this.controller.signal,
      });

      if (!response.body) throw new Error("No response body from CouchDB");

      const reader = response.body.getReader();
      let buffer = '';

      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            try {
              const parsed = JSON.parse(line);
              if (parsed && parsed.doc) {
                onChange(parsed.doc);
              }
            } catch (e) {
              onError?.(e);
            }
          }
        }
      }
    } catch (err) {
      if (this.running) {
        onError?.(err);
      }
    }
  }

  public stop() {
    if (!this.running) return;
    this.running = false;
    this.controller.abort();
  }
}


export const userState = new WatchableValue<User | null>(null);
export const brainState = new WatchableValue<State | null>(null);