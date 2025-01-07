import { getCookie } from "typescript-cookie";

import { fetchOk } from "src/util/http_request";
import { StatusMessage } from "src/status";
import { WatchableValue } from "src/trackable_value";
import { APIs } from "src/brainshare/service";

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
      lab: "NA"
    };
  })
}

/**
 * Creates a new neuroglancer_state in the database via a REST POST
 * Authorization is required
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

export const userState = new WatchableValue<User | null>(null);
export const brainState = new WatchableValue<State | null>(null);