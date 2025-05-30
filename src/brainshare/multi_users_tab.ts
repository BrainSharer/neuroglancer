import "./multi_users_tab.css";

import debounce from "lodash/debounce";
import svg_swap_horizontal from "ikonate/icons/swap-horizontal.svg";
import { RefCounted } from "#/util/disposable";
import { getCachedJson, Trackable } from "#/util/trackable";
import { makeIcon } from "#/widget/icon";
import { Tab } from "#/widget/tab_view";
import { WatchableValue } from "#/trackable_value";
import { brainState, userState, upsertCouchState, upsertCouchUser, fetchUserDocument, 
  listenToDocumentChanges } from "./state_utils";
import { verifyObject } from "src/util/json";
import { APIs } from "./service";

enum MultiUsersStatus {
  disabled = 1,
  sharing,
  observing,
  no_state,
}

interface MultiUsersState {
  status: MultiUsersStatus,
  state_id: string,
  username: string,
  editor: string,
  usernames: Array<string>,
}


class MultiUsersTabItem extends RefCounted {
  element = document.createElement("div");
  numberElement = document.createElement("div");
  textElement = document.createElement("div");
  swapButton: HTMLElement;
 
  constructor(
    private otherUsername: string,
    private multiUsersState: WatchableValue<MultiUsersState>,
  ) {
    super();

    const { state_id, editor } = this.multiUsersState.value;
    this.element.classList.add("neuroglancer-multi-users-tab-item");
    this.numberElement.classList.add("neuroglancer-multi-users-tab-item-number");
    this.textElement.classList.add("neuroglancer-multi-users-tab-item-text");
    
    this.swapButton = makeIcon({ 
      svg: svg_swap_horizontal,
      title: "swap",
      onClick: () => {
        const doc: any = {[editor]: false, [this.otherUsername]: true};
        upsertCouchUser(state_id, doc);
      },
    });
    this.swapButton.classList.add("neuroglancer-multi-users-tab-item-icon");
    this.element.appendChild(this.numberElement);
    this.element.appendChild(this.textElement);
    // this.element.appendChild(this.swapButton);
  }
}

export class MultiUsersTab extends Tab {
  headerContainer = document.createElement("div");
  itemContainer = document.createElement("div");
  header = document.createElement("div");
  actionButton = makeIcon({ text: "Action" });

  private userItems = new Map<String, MultiUsersTabItem>();
  private prevStateGeneration: number | undefined;
  private throttledUpdateStateToCouch: () => void;

  private multiUsersState = new WatchableValue<MultiUsersState>({
    state_id: "",
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
          const state_id = String(brainState.value.id);
          this.throttledUpdateStateToCouch = debounce(() => {
            const cacheState = getCachedJson(this.viewerState);
            const { generation, value } = cacheState;
            if ((generation !== undefined) && (generation !== this.prevStateGeneration)) {
                console.log('Updating state to CouchDB:', state_id, generation);
                this.prevStateGeneration = cacheState.generation;
                upsertCouchState(state_id, verifyObject(value))
            }

          }, 2500);

          /**  Check user status right away and then setup the listener */
          this.updateMultiUsersStatus();

          this.userDocumentListener = listenToDocumentChanges({
            dbUrl: APIs.GET_SET_COUCH_USER,
            docId: state_id,
            onChange: (change) => {
              console.log('User change detected:', change);
              if (change.doc === undefined) {
                console.log('User document change detected but change.doc is undefined');
              } 
              if (change.doc.users === undefined) {
                console.log('User document change detected but change.doc.users is undefined');
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
                console.log('User document change detected: status', status);
                this.multiUsersState.value = {
                  status,
                  username,
                  state_id,
                  editor,
                  usernames,
                };
              } else {
                this.multiUsersState.value = {
                  status: MultiUsersStatus.disabled,
                  username,
                  state_id,
                  editor: "",
                  usernames: [],
                };
              }
            },
            onError: (err) => {
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


  private updateHeaderAndListener() {
    const { status, username, state_id, editor, usernames } = this.multiUsersState.value;
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
          users = {[username]: true};
        } else {
          updated_usernames = updated_usernames.filter(user => user !== editor);
          updated_usernames.push(username);
          users[editor] = true;
          updated_usernames.forEach((user) => {
            users[user] = false;
          });

        }
        upsertCouchUser(state_id, users);
      };

    }
    else if (status === MultiUsersStatus.sharing) {
      // Add state change listener
      this.viewerState.changed.add(this.throttledUpdateStateToCouch);
      headerTextContent = "You are sharing";
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        const users: any = {};
        upsertCouchUser(state_id, users);
      };
    }
    else if (status === MultiUsersStatus.observing) {
      console.log('Observing state', state_id);
      this.stateDocumentListener = listenToDocumentChanges({
        dbUrl: APIs.GET_SET_COUCH_STATE,
        docId: state_id,
        onChange: (change) => {
          console.log('State change detected while observing:', change);
          const data = change.doc;
          if ((data !== undefined) && (data.state !== undefined)) {
            const state: Object = data.state;
            if (state !== undefined && typeof state === "object") {
              console.log('State document change detected:');
              console.log(state);
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

      // Update UI
      headerTextContent = "You are observing " + editor;
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        let users: any = {[editor]: true};
        updated_usernames = updated_usernames.filter(user => user !== editor);
        updated_usernames = updated_usernames.filter(user => user !== username);
        users[editor] = true;
        updated_usernames.forEach((user) => {
          users[user] = false;
        });
        console.log('Stopping observing for user', username)
        console.log('editor:', editor);
        console.log('updated usernames:', updated_usernames);
        console.log('users:', users);


        upsertCouchUser(state_id, users);
        //this.stateDocumentListener.close(); // stops the listener
        console.log('We need to remove state listener in observing');
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
    const state_id = String(brainState.value.id);

    fetchUserDocument(state_id).then((result) => {
      console.log('fetchuserDocument result:', result);
      if ((result !== null) && (result.users !== undefined) && (Object.keys(result.users).length !== 0)) {
        const data = result.users;
        console.log('Users found data users:', data);
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
          state_id,
          editor,
          usernames,
        };
      } else {
        console.log('Users found but no data doc', result);
        this.multiUsersState.value = {
          status: MultiUsersStatus.disabled,
          username,
          state_id,
          editor: "",
          usernames: [],
        };
      }
      this.multiUsersState.changed.dispatch();
    });
  }
}
