import { getCookie } from "typescript-cookie";
import { fetchOk } from "#/util/http_request";
import { StatusMessage } from "#/status";
import { WatchableValue } from "#/trackable_value";
import { APIs } from "./service";

export interface CouchUserDocument {
  _id: string;          // Unique document ID
  _rev?: string;        // Revision token, optional for new docs
  _deleted?: boolean;   // If true, marks the document as deleted
  doc: any;
}

export interface CouchStateDocument {
  _id: string;          // Unique document ID
  _rev?: string;        // Revision token, optional for new docs
  _deleted?: boolean;   // If true, marks the document as deleted
  state: State;
}

export interface UrlParams {
  "stateID": string | null,
}
type ChangeHandler = (change: any) => void;

/**
 * This function gets the two parameters from the URL
 * 1. The id which is the primary key in the neuroglancer state table
 * 2. multi which is a boolean saying if we are in multi user mode or not.
 * @returns a JSON dictionary of the two variables
 */
export function getUrlParams(): any {
  const href = new URL(location.href);
  const stateID = href.searchParams.get("id");
  const loaded = Boolean(Number(href.searchParams.get("loaded")));
  const locationVariables = { stateID, loaded };
  return locationVariables;
}

export interface State {
  id: number;
  user: string;
  owner: number;
  animal: string;
  comments: string;
  user_date: string;
  neuroglancer_state: object;
  readonly: boolean;
  public: boolean;
  lab: string;
}

export interface User {
  id: number;
  username: string;
  lab: string;
}

export interface Revision {
  id: number;
  FK_neuroglancer_state_id: number;
  state: Object;
  editor: string;
  users: string;
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
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage(
      "The brain ID is not in the database. Please check again."
    );
    brainState.value = {
      id: 0,
      user: "",
      owner: 0,
      animal: "",
      comments: err,
      user_date: "0",
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

  fetchOk(APIs.GET_SET_STATE, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
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
  })
}

/**
 * This saves the data in the DB via a REST PUT
 * @param stateID  The integer from the REST API of the neuroglancer_state id
 * @param state the JSON state
 * @returns the JSON state
 */
export function saveState(stateID: number | string, state: Object) {
  const json_body = { ...brainState.value, ...state }

  fetchOk(APIs.GET_SET_STATE + stateID, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    //TODO take this upsert out later!
    upsertCouchState(JSON.stringify(stateID), json);
    StatusMessage.showTemporaryMessage("The current neuroglancer state has been saved.", 10000);
  });
}
/**
 * Couch user methods
 */

export async function fetchUserDocument(stateID: string): Promise<CouchUserDocument | null> {
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
  if (revision === null) { 
    console.log("No user found when looking for revision");
    return null;
  } else {
    console.log('found user revision', revision);
  }
  try {
    const response = await fetch(APIs.GET_SET_COUCH_USER + "/" + parseInt(stateID), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data: CouchUserDocument = await response.json();
    StatusMessage.showTemporaryMessage("A couch state has been fetched." + data._rev, 10000);
    return data;
  } catch (error) {
    console.error('Error fetching CouchDB document:', error);
    return null;
  }
}

export async function insertCouchUser(stateID: string, editor: string, usernames?: string[]) {
  console.log("method insertCouchUser");
  const json_body = { "editor": editor, "usernames": usernames };
  fetchOk(APIs.GET_SET_COUCH_USER + parseInt(stateID), {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current user data has been saved to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current user data has NOT been saved to couch.", 10000);
  });
}


export async function upsertCouchUser(stateID: string, doc: any) {
  console.log("method upsertCouchUser with ID: " + stateID);
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_USER, stateID);
  let couchState: CouchUserDocument = {_id: stateID, doc };
  if (revision !== null) { 
    couchState = {_id: stateID, _rev: revision, doc };
  }
  updateCouchDBDocument(APIs.GET_SET_COUCH_USER, stateID, couchState);
}


/**
 * Couch state methods
 */

export async function upsertCouchState(stateID: string, state: State) {
  console.log("method upsertCouchState");
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
  let couchState: CouchStateDocument = {_id: stateID, "state": state };
  if (revision !== null) { 
    couchState = {_id: stateID, _rev: revision, "state": state };
  }
  updateCouchDBDocument(APIs.GET_SET_COUCH_STATE, stateID, couchState);
}


export async function fetchStateDocument(stateID: string): Promise<CouchStateDocument | null> {
  const revision = await getRevisionFromChangesFeed(APIs.GET_SET_COUCH_STATE, stateID);
  if (revision === null) { 
    console.log("No state found when looking for revision");
    return null;
  } else {
    console.log('found state revision', revision);
  }
  try {
    const response = await fetch(APIs.GET_SET_COUCH_STATE + "/" + parseInt(stateID), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data: CouchStateDocument = await response.json();
    StatusMessage.showTemporaryMessage("A couch state has been fetched." + data._rev, 10000);
    return data;
  } catch (error) {
    console.error('Error fetching CouchDB state document:', error);
    return null;
  }
}


async function updateCouchDBDocument<T>(
  dbUrl: string,
  _id: string,
  updatedDoc: T,
  auth?: { username: string; password: string }
): Promise<T> {


  if (!_id) {
    throw new Error("Document must have _id ");
  }
  const url = `${dbUrl}/${encodeURIComponent( _id)}`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (auth) {
    const credentials = btoa(`${auth.username}:${auth.password}`);
    headers["Authorization"] = `Basic ${credentials}`;
  }

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


async function getRevisionFromChangesFeed(couchDbUrl: string, docId: string): Promise<string | null> {
  const url = `${couchDbUrl}/_changes?include_docs=true&filter=_doc_ids`;
  const body = {
    doc_ids: [docId]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      return null;
      // throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    
    const change = data.results.find((result: any) => (result.id === docId));

    if (change) {
      return change.changes?.[0]?.rev || null;
    }

    return null;
  } catch (error) {
    console.error("Error fetching _changes feed:", error);
    return null;
  }
}

export async function listenForDocumentChanges(
  dbUrl: string,
  docId: string,
  onChange: ChangeHandler
) {
  const url = new URL(`${dbUrl}/_changes`);
  url.searchParams.set('feed', 'continuous');
  url.searchParams.set('include_docs', 'true');
  url.searchParams.set('since', 'now');
  url.searchParams.set('filter', '_doc_ids');
  
  const body = JSON.stringify({ doc_ids: [docId] });

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.body) {
    throw new Error('No response body from CouchDB');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    let lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Last incomplete line stays in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const change = JSON.parse(line);
          onChange(change);
        } catch (e) {
          console.error('Failed to parse change line:', line, e);
        }
      }
    }
  }
}



export async function deleteCouchDbDocument(
  dbUrl: string,
  stateID: string,
  username?: string,
  password?: string
): Promise<void> {
  console.log("method deleteCouchDbDocument");
  const revision = await getRevisionFromChangesFeed(dbUrl, stateID);

  if (revision === null) {
    console.error("Cannot delete document as the revision is null.");
    return;
  }

  try {
    const url = new URL(`${dbUrl}/${encodeURIComponent(stateID)}?rev=${encodeURIComponent(revision)}`);

    const headers: HeadersInit = {};
    if (username && password) {
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: headers,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to delete document: ${errorData.reason}`);
    }

    console.log(`Document ${stateID} deleted successfully.`);
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
}
export const userState = new WatchableValue<User | null>(null);
export const brainState = new WatchableValue<State | null>(null);