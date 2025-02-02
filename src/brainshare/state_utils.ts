import { getCookie } from "typescript-cookie";

import { fetchOk } from "#/util/http_request";
import { StatusMessage } from "#/status";
import { WatchableValue } from "#/trackable_value";
import { APIs } from "./service";

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
): Promise<void> | undefined{
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
    StatusMessage.showTemporaryMessage("The current neuroglancer state has been saved.", 10000);
  });
}

/**
 * Couch Couch Couch Couch Couch user methods
 */
async function fetchUserRevision(stateID: number | string): Promise<any> {
  const response = await fetchOk(APIs.GET_SET_COUCH_STATE + stateID, {
    method: "GET",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const json = await response.json();
  StatusMessage.showTemporaryMessage("A couch state has been fetched." + json._rev, 10000);
  return json;
}

export async function insertCouchUser(stateID: string | number) {
  const data = {"editor": "joe",  "otherUsers": ["imauser"]};
  fetchOk(APIs.GET_SET_COUCH_USER + JSON.stringify(stateID), {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer user has been saved to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current neuroglancer user has NOT been saved to couch.", 10000);
  });

}

export async function updateCouchUser(stateID: number | string, editor: string, otherUsername: string) {
  console.log('updateCouchUser', stateID, editor, otherUsername);
  const users = await fetchUserRevision(stateID);
  const data = {"_rev": users._rev, "editor": editor,  "otherUsers": [otherUsername]};
  fetchOk(APIs.GET_SET_COUCH_STATE + stateID, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer user has been saved to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current neuroglancer user has NOT been saved to couch.", 10000);
  });

}

export async function updateCouchUserRemoveEditor(stateID: number | string) {
  const users = await fetchUserRevision(stateID);
  const data = {"_rev": users._rev, "editor": ""};
  fetchOk(APIs.GET_SET_COUCH_STATE + stateID, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer user has been saved to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current neuroglancer user has NOT been saved to couch.", 10000);
  });

}

/**
 * Couch state methods
 */

export async function fetchCouchStateXXXX(stateID: number | string): Promise<any> {
  const response = await fetchOk(APIs.GET_SET_COUCH_STATE + stateID, {
    method: "GET",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const json = await response.json();
  StatusMessage.showTemporaryMessage("A couch state has been fetched." + json._rev, 10000);
  return json;
}


export async function fetchStateRevision(stateID: number | string): Promise<any> {
  const response = await fetchOk(APIs.GET_SET_COUCH_STATE + stateID, {
    method: "GET",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const json = await response.json();
  StatusMessage.showTemporaryMessage("A couch state has been fetched." + json._rev, 10000);
  return json._rev;
}

export function upsertCouchState(stateID: string | number, state: State) {
  stateID = JSON.stringify(stateID);
  fetchStateRevision(stateID).then(_rev => {
    if (_rev === undefined) {
      console.log('insertCouchState', stateID, state);
      insertCouchState(stateID, state);
    } else {
      console.log('updateCouchState', stateID, _rev, state);
      updateCouchState(stateID, _rev, state);
    }
  });
}


function insertCouchState(stateID: string | number, state: State) {
  const json_body = { ...brainState.value, ...state }
  fetchOk(APIs.GET_SET_COUCH_STATE + JSON.stringify(stateID), {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer state has been saved to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current neuroglancer state has NOT been saved to couch.", 10000);
  });

}

function updateCouchState(stateID: string, _rev: string, state: State) {
  const json_body = { ...brainState.value, ...state, "_rev": _rev }
  const url = APIs.GET_SET_COUCH_STATE + JSON.stringify(stateID); 
  console.log('PUT URL', url);

  fetchOk(url, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_body, null, 0),
  }).then(response => response.json()).then(json => {
    brainState.value = json;
    StatusMessage.showTemporaryMessage("The current neuroglancer state has been updated to couch.", 10000);
  }).catch(err => {
    console.log(err);
    StatusMessage.showTemporaryMessage("The current neuroglancer state has NOT been updated to couch.", 10000);
  });
}


export const userState = new WatchableValue<User | null>(null);
export const brainState = new WatchableValue<State | null>(null);