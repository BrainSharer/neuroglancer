import { getCookie } from 'typescript-cookie';

import { Completion } from '#/util/completion';
import { AutocompleteTextInput } from '#/widget/multiline_autocomplete';
import { CancellationToken } from '#/util/cancellation';
import { fetchOk } from '#/util/http_request';
import { StatusMessage } from '#/status';
import { Trackable } from '#/util/trackable';
import { WatchableValue } from '#/trackable_value';

//
// Autocompletion 
//

/**
 * Define the state completion cell
 */
export interface CompletionWithState extends Completion {
  date: string;
  json: string;
}

/**
 * Fuzzy search algorithm in Typescript.
 * https://github.com/bevacqua/fuzzysearch
 * @param needle
 * @param haystack
 */
export function fuzzySearch(needle: string, haystack: string) {
  const hlen = haystack.length;
  const nlen = needle.length;
  if (nlen > hlen) {
    return false;
  }
  if (nlen === hlen) {
    return needle === haystack;
  }
  outer: for (let i = 0, j = 0; i < nlen; i++) {
    const nch = needle.charCodeAt(i);
    while (j < hlen) {
      if (haystack.charCodeAt(j++) === nch) {
        continue outer;
      }
    }
    return false;
  }
  return true;
}

/**
 * Define how to display a state completion cell
 * @param completion
 */
export function makeCompletionElementWithState(
  completion: CompletionWithState
) {
  const element = document.createElement('div');
  element.textContent = completion.value || '';
  const dateElement = document.createElement('div');
  dateElement.textContent = completion.date || '';
  element.appendChild(dateElement);
  return element;
}

/**
 * This class takes care of taking the JSON data
 * and put it into a state that Neuroglancer can use.
 */
export class StateAutocomplete extends AutocompleteTextInput {
  public _allCompletions: CompletionWithState[] = [];
  private curCompletions: CompletionWithState[] = [];

  constructor(
    private viewerState: Trackable
  ) {
    super({ 
      completer: (value: string, _cancellationToken: CancellationToken) => {
        this.curCompletions = [];
        for (const result of this.allCompletions) {
          if (fuzzySearch(value, result['value'])) {
            this.curCompletions.push(result);
          }
        }

        return Promise.resolve({
          completions: this.curCompletions,
          offset: 0,
          showSingleResult: true,
          selectSingleResult: true,
          makeElement: makeCompletionElementWithState,
        });
      }, 
      delay: 0
    });

    this.placeholder = 'State comment';
  }

  selectCompletion(index: number) {
    try {
      const completion = this.curCompletions[index];
      const stateJson = JSON.parse(completion.json);
      this.viewerState.restoreState(stateJson);
      StatusMessage.showTemporaryMessage(
        `JSON file loaded successfully: ${completion.value}`
      );
    }
    catch (e) {
      StatusMessage.showTemporaryMessage('Internal error: invalid JSON');
    }
  }

  disableCompletions() {
    this.allCompletions = [];
  }

  set allCompletions(results: CompletionWithState[]) {
    this._allCompletions = results;
  }

  get allCompletions() {
    return this._allCompletions;
  }
}

//
// State API
//

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
  const id = href.searchParams.get("id");
  const locationVariables = {
    "stateID": id,
  };
  return locationVariables;
}

export interface State {
  id: number;
  owner: number;
  comments: string;
  user_date: string;
  neuroglancer_state: Record<string, unknown>;
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
 * This class works with the REST API with the Neuroglancer state.
 * Authentication is done via a cookie which is initially set by Django in 
 * the neuroglancer/apis.py and neuroglancer/services.py programs.
 * The angular frontend also uses these cookies.
 */
export class StateAPI {
  urlParams: UrlParams;
  userState = new WatchableValue<User | null>(null);
  brainState = new WatchableValue<State | null>(null);

  constructor(private stateUrl: string) {
    this.urlParams = getUrlParams();

    // Fetch User in cookie
    this.getUser();

    // Fetch the state based on URL
    const stateID = this.urlParams.stateID;
    if (stateID) {
      this.getState(stateID);
    }
  }

  /**
   * username and id are both cookies
   * If the user_id (id) cookie exists, use it, otherwise set to 0
   * If the username cookie exists, use it, otherwise set to an empty string
   * @returns json of user
   */
  getUser() {
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

    this.userState.value = userjson;
  }

  /**
   * No authentication/authorization is required to get data
   * @param stateID The integer from the REST API of the neuroglancer_state id.
   * @returns the JSON state
   */
  getState(stateID: number | string) {
    const url = `${this.stateUrl}/${stateID}`;

    fetchOk(url, { method: 'GET' }).then(
      response => response.json()
    ).then(json => {
      this.brainState.value = json;
    }).catch(err => {
      StatusMessage.showTemporaryMessage(
        'The URL is deleted from database. Please check again.'
      );
      this.brainState.value = {
        id: 0,
        owner: 0,
        comments: err,
        user_date: "0",
        neuroglancer_state: {},
        readonly: false,
        public: false,
        lab: 'NA'
      };
    })
  }

  /**
   * Creates a new neuroglancer_state in the database via a REST POST
   * Authorization is required
   * @param state the JSON state
   * @returns the JSON state
   */
  newState(state: Object) {
    const url = this.stateUrl;
    const json_body = { ...this.brainState.value, ...state }

    fetchOk(url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(json_body, null, 0),
    }).then(
      response => response.json()
    ).then(json => {
      const href = new URL(location.href);
      href.searchParams.set('id', json['id']);
      window.history.pushState({}, '', href.toString());
      this.urlParams.stateID = json['id'];

      this.brainState.value = json;
    })
  }

  /**
   * This saves the data in the DB via a REST PUT
   * @param stateID  The integer from the REST API of the neuroglancer_state id
   * @param state the JSON state
   * @returns the JSON state
   */
  saveState(stateID: number | string, state: Object) {
    const url = `${this.stateUrl}/${stateID}`;
    const json_body = { ...this.brainState.value, ...state }

    fetchOk(url, {
      method: 'PUT',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(json_body, null, 0),
    }).then(response => response.json()).then(json => {
      this.brainState.value = json;
    });
  }
}