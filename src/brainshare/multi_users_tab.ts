import "./multi_users_tab.css";

import { debounce } from "lodash-es"
// Update the path below to the actual location of swap-horizontal.svg in your project
import svg_swap_horizontal from "ikonate/icons/swap-horizontal.svg?raw";
import { RefCounted } from "#src/util/disposable.js";
import type { Trackable } from "#src/util/trackable.js";
import { getCachedJson } from "#src/util/trackable.js";
import { makeIcon } from "#src/widget/icon.js";
import { Tab } from "#src/widget/tab_view.js";
import { WatchableValue } from "#src/trackable_value.js";
import { brainState, userState} from "#src/brainshare/state_utils.js";
import { verifyObject } from "#src/util/json.js";
import { APIs } from "#src/brainshare/service.js";
import { CouchDB, objectsAreEqual } from "#src/brainshare/couch.js";

enum MultiUsersStatus {
  disabled = 1,
  sharing,
  observing,
  no_state,
}

interface MultiUsersState {
  status: MultiUsersStatus,
  stateID: string,
  username: string,
  editor: string,
  usernames: Array<string>,
}

class MultiUsersTabItem extends RefCounted {
  element = document.createElement("div");
  numberElement = document.createElement("div");
  textElement = document.createElement("div");
  swapButton: HTMLElement;
  private couchDBClient = new CouchDB();

  constructor(
    private otherUsername: string,
    private multiUsersState: WatchableValue<MultiUsersState>,
  ) {
    super();

    const { stateID, editor, usernames } = this.multiUsersState.value;
    let updated_usernames = usernames;

    this.element.classList.add("neuroglancer-multi-users-tab-item");
    this.numberElement.classList.add("neuroglancer-multi-users-tab-item-number");
    this.textElement.classList.add("neuroglancer-multi-users-tab-item-text");

    this.swapButton = makeIcon({
      svg: svg_swap_horizontal,
      title: "swap",
      onClick: () => {
        let users: any = { [editor]: true };
        updated_usernames = updated_usernames.filter(user => user !== editor);
        users[editor] = false;
        updated_usernames.forEach((user) => {
          users[user] = false;
        });
        users[this.otherUsername] = true;
        this.couchDBClient.upsertCouchUser(stateID, users);
        console.debug('Swap button clicked this.otherUsername:', this.otherUsername);
        console.debug('Swap button clicked editor:', editor);
      },
    });
    this.swapButton.classList.add("neuroglancer-multi-users-tab-item-icon");
    this.element.appendChild(this.numberElement);
    this.element.appendChild(this.textElement);
    this.element.appendChild(this.swapButton);
  }
}

export class MultiUsersTab extends Tab {
  headerContainer = document.createElement("div");
  itemContainer = document.createElement("div");
  header = document.createElement("div");
  actionButton = makeIcon({ text: "Action" });

  private userItems = new Map<string, MultiUsersTabItem>();
  private prevStateGeneration: number | undefined;
  private throttledUpdateStateToCouch: () => void;
  private couchDBClient = new CouchDB();

  private multiUsersState = new WatchableValue<MultiUsersState>({
    stateID: "",
    username: "",
    editor: "",
    usernames: [],
    status: MultiUsersStatus.no_state,
  });
  protected userDocumentListener: { stop: () => void; };
  protected stateDocumentListener: { stop: () => void; };


  constructor(
    private viewerState: Trackable,
  ) {
    super();

    this.init_ui();

    userState.changed.add(() => {
      this.stateUpdated();
    });
    brainState.changed.add(() => {
      this.stateUpdated();
    });
    this.multiUsersState.changed.add(() => {
      this.multiUsersStateUpdated();

    })
    this.stateUpdated();
    this.multiUsersStateUpdated();
  }

  private init_ui() {
    // Container
    this.element.classList.add("neuroglancer-multi-users-tab-container");
    this.element.appendChild(this.headerContainer);
    this.element.appendChild(this.itemContainer);

    // Header
    this.headerContainer.classList.add(
      "neuroglancer-multi-users-tab-header-container"
    );
    this.headerContainer.appendChild(this.header);
    this.headerContainer.appendChild(this.actionButton);

    this.header.classList.add("neuroglancer-multi-users-tab-header");
    this.header.textContent = "Load a state to enable multi-user mode"
    this.actionButton.style.display = "none";

    // Item container
    this.itemContainer.classList.add(
      "neuroglancer-multi-users-tab-item-container"
    );
  }

  /**
   * Handles updates to the application state based on the current user and brain state.
   * 
   * This method performs the following actions:
   * - If the `userState` is not null and the user's ID is `0`, it detaches the user change listener.
   * - If the `userState` is not null and the user's ID is not `0`, and the `brainState` is not null:
   *   - Sets up a debounced function to update the state to CouchDB.
   *   - Immediately checks the multi-user status and sets up a listener for document changes.
   *   - Dispatches a change event for the multi-user state.
   * 
   * The method ensures that state updates are throttled to avoid excessive updates and
   * listens for changes in the user document to keep the multi-user status synchronized.
   * Currently, it checks every 2500ms (2.5 seconds) for changes in the state.
   * The update timing needs to be reduced. 2500 is too long for a good user experience.
   * It used to be 10 which works well in for displaying to other users
   * All tests failed with polygon points being out of sync when set above 10sec.
   */
  private stateUpdated() {

    if (userState.value !== null) {
      if (userState.value.id === 0) {
        if (this.userDocumentListener !== undefined) {
          this.userDocumentListener.stop();
        }
      } else {
        if (brainState.value !== null) {
          const username = String(userState.value.username);
          const stateID = String(brainState.value.id);
          this.throttledUpdateStateToCouch = debounce(async () => {
            const cacheState = getCachedJson(this.viewerState);
            const { generation, value } = cacheState; 
            if ((generation !== undefined) && (generation !== this.prevStateGeneration) && (objectsAreEqual(value, brainState.value.neuroglancer_state) === false)) {
              this.prevStateGeneration = cacheState.generation;
              this.couchDBClient.upsertCouchState(stateID, verifyObject(value));
              brainState.value.neuroglancer_state = verifyObject(value);
            } 
          }, 400);

          /**  Check user status right away and then setup the listener */
          this.updateMultiUsersStatus();

          this.userDocumentListener = this.couchDBClient.listenToDocumentChanges({
            dbUrl: APIs.GET_SET_COUCH_USER,
            docId: stateID,
            onChange: (change) => {
              console.debug('User change detected:', change);
              if (change.doc === undefined) {
                console.debug('User document change detected but change.doc is undefined');
              }
              if (change.doc.users === undefined) {
                console.debug('User document change detected but change.doc.users is undefined');
              }

              const data = change.doc.users;

              if (data !== undefined && Object.keys(data).length !== 0) {
                const editors = Object.keys(data).filter(
                  key => data[key]
                );
                const editor = editors.length > 0 ? editors[0] : "";
                const usernames = Object.keys(data);

                const status = usernames.includes(username) ? (
                  editor === username ? MultiUsersStatus.sharing
                    : MultiUsersStatus.observing
                ) : MultiUsersStatus.disabled;
                this.multiUsersState.value = {
                  status,
                  username,
                  stateID,
                  editor,
                  usernames,
                };
              } else {
                this.multiUsersState.value = {
                  status: MultiUsersStatus.disabled,
                  username,
                  stateID,
                  editor: "",
                  usernames: [],
                };
              }
            },
            onError: (err: any) => {
              console.error('State listner error:', err);
            },
          });
          this.multiUsersState.changed.dispatch();
        }
      }
    }
  }

  private multiUsersStateUpdated() {
    this.updateHeaderAndListener();
    this.updateUserItems();
  }


  private async updateHeaderAndListener() {
    const { status, username, stateID, editor, usernames } = this.multiUsersState.value;
    let updated_usernames = usernames;

    // Remove any listener if any
    this.viewerState.changed.remove(this.throttledUpdateStateToCouch);
    if (this.stateDocumentListener !== undefined) {
          this.stateDocumentListener.stop();
    }
    let headerTextContent = "";
    let actionButtonDisplay = "";
    let actionButtonTextContent = "";
    let actionButtonOnclick = () => { };
    // Deal with the different status types
    /**
     * When the status is disabled, a user can observe if someone
     * else is sharing, otherwise, the user can share
     * If no one is sharing, the text reads "No one is sharing" Share
     * and the list of users is empty
     */
    if (status === MultiUsersStatus.disabled) {
      // Update UI
      const header_editor = editor === "" ? "No one" : editor;
      headerTextContent = header_editor + " is sharing";
      actionButtonDisplay = "block";
      actionButtonTextContent = editor === "" ? "Share" : "Observe";
      actionButtonOnclick = () => {
        let users: any = {};
        if (editor === "") {
          users = { [username]: true };
        } else {
          updated_usernames = updated_usernames.filter(user => user !== editor);
          updated_usernames.push(username);
          users[editor] = true;
          updated_usernames.forEach((user) => {
            users[user] = false;
          });
        }
        this.couchDBClient.upsertCouchUser(stateID, users);
      }
    }
    else if (status === MultiUsersStatus.sharing) {
      // Add state change listener
      this.viewerState.changed.add(this.throttledUpdateStateToCouch);
      headerTextContent = "You are sharing";
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        const users: any = {};
        this.couchDBClient.upsertCouchUser(stateID, users);
      };
    }
    else if (status === MultiUsersStatus.observing) {
      console.debug('Observing state', stateID);
      /** Set initial document from couch */
      const baseDoc = await this.couchDBClient.fetchStateDocument(stateID);
      if ((baseDoc !== null) && (baseDoc.data !== undefined)) {
        const state: object = baseDoc.data;
        if (state !== undefined && typeof state === "object") {
          console.debug('Restoring viewer state from baseDoc:');
          this.viewerState.reset();
          this.viewerState.restoreState(verifyObject(state));
        } else {
          console.error('Base document data is either null or undefined', state);
        }
      } else {
        console.error('Base document is null or has no data');
      }
      /** End initial set from couch */
      /** Start viewer initialization and listener code */
      this.stateDocumentListener = this.couchDBClient.listenToDocumentChanges({
        dbUrl: APIs.GET_SET_COUCH_STATE,
        docId: stateID,
        onChange: (change) => {
          const baseDoc = change.doc;
          if ((baseDoc !== undefined) && (baseDoc.data !== undefined)) {
            const state: object = baseDoc.data;
            if (state !== undefined && typeof state === "object") {
              console.debug('State document change detected:');
              this.viewerState.reset();
              try {
                this.viewerState.restoreState(verifyObject(state));
              } catch (error) {
                console.error('Error restoring state from document change:', error);
              }
            } else {
              console.error('State document change detected but either null or undefined', state);
            }
          } else {
            console.error('State document change detected but no data');
          }
        }
      });
      /** End viewer initialization code */
      // Update UI
      headerTextContent = "You are observing " + editor;
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        let users: any = { [editor]: true };
        updated_usernames = updated_usernames.filter(user => user !== editor);
        updated_usernames = updated_usernames.filter(user => user !== username);
        users[editor] = true;
        updated_usernames.forEach((user) => {
          users[user] = false;
        });
        console.debug('Stopping observing for user', username)
        console.debug('editor:', editor);
        console.debug('updated usernames:', updated_usernames);
        console.debug('users:', users);

        this.couchDBClient.upsertCouchUser(stateID, users);
        console.debug('We need to remove state listener in observing');
        // couchListener.stop();
        this.stateDocumentListener.stop();
      };
    }
    else if (status === MultiUsersStatus.no_state) {
      headerTextContent = "Load a state to enable multi-user mode"
      actionButtonDisplay = "none";
      actionButtonTextContent = "";
      actionButtonOnclick = () => { };
    }

    this.header.textContent = headerTextContent;
    this.actionButton.style.display = actionButtonDisplay;
    this.actionButton.textContent = actionButtonTextContent;
    this.actionButton.onclick = actionButtonOnclick;
  }

  private updateUserItems() {
    const { status, editor, usernames } = this.multiUsersState.value;


    // Update userItems
    this.userItems.clear();
    this.itemContainer.innerHTML = "";
    usernames.forEach((otherUsername, index) => {
      let userItem = this.userItems.get(otherUsername);
      if (userItem === undefined) {
        userItem = new MultiUsersTabItem(otherUsername, this.multiUsersState);
        userItem.numberElement.textContent = String(index + 1);
        userItem.textElement.textContent = otherUsername;
        this.itemContainer.appendChild(userItem.element);
        this.userItems.set(otherUsername, userItem);
      }

      userItem.element.style.borderColor = otherUsername === editor ?
        "#3c3" : "rgba(0, 0, 0, 0";
      userItem.swapButton.style.display = otherUsername === editor ? "none" : (
        status === MultiUsersStatus.sharing ? "block" : "none"
      )
    });

  }

  private updateMultiUsersStatus() {
    if ((userState.value === null) || (brainState.value === null)) {
      console.error("userState or brainState is null");
      return;
    }
    const username = String(userState.value.username);
    const stateID = String(brainState.value.id);

    this.couchDBClient.fetchUserDocument(stateID).then((result) => {
      console.debug('fetchuserDocument result:', result);
      if ((result !== null) && (result.users !== undefined) && (Object.keys(result.users).length !== 0)) {
        const data = result.users;
        console.debug('Users found data users:', data);
        const editors = Object.keys(data).filter(
          key => data[key]
        );
        const editor = editors.length > 0 ? editors[0] : "";
        const usernames = Object.keys(data);

        const status = usernames.includes(username) ? (
          editor === username ? MultiUsersStatus.sharing
            : MultiUsersStatus.observing
        ) : MultiUsersStatus.disabled;

        this.multiUsersState.value = {
          status,
          username,
          stateID,
          editor,
          usernames,
        };
      } else {
        console.debug('Users found but no data doc', result);
        this.multiUsersState.value = {
          status: MultiUsersStatus.disabled,
          username,
          stateID,
          editor: "",
          usernames: [],
        };
      }
      this.multiUsersState.changed.dispatch();
    });
  }
}
