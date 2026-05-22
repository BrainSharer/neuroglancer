import { getCookie } from "typescript-cookie";
import { fetchOk } from "#src/util/http_request.js";
import { StatusMessage } from "#src/status.js";
import { WatchableValue } from "#src/trackable_value.js";
import { APIs } from "#src/brainshare/service.js";
import { State, User } from "#src/brainshare/types.js";

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
  const admin = getCookie("admin") ?? "false";
  const lab = getCookie("lab") ?? "";
  const access = getCookie("access") ?? "";

  let userjson = { "id": 0, "admin": "false", "username": "", "lab": "", "access": "" };
  if ((id !== 0) && (username !== "")) {
    userjson = {
      "id": +id,
      "admin": admin.toLowerCase(),
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
export function newState(state: State) {
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
export function saveState(stateID: number | string, state: State) {
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

export const userState = new WatchableValue<User | null>(null);
export const brainState = new WatchableValue<State | null>(null);
