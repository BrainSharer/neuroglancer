import "./multi_users_tab.css";

import debounce from "lodash/debounce";
import firebase from 'firebase/compat/app';
import svg_swap_horizontal from "ikonate/icons/swap-horizontal.svg";

import { RefCounted } from "#/util/disposable";
import { getCachedJson, Trackable } from "#/util/trackable";
import { makeIcon } from "#/widget/icon";
import { Tab } from "#/widget/tab_view";
import { WatchableValue } from "#/trackable_value";
import { brainState, userState } from "./state_utils";
import { db } from "./firestore";
import { verifyObject } from "src/util/json";
import { StatusMessage } from "src/status";


enum MultiUsersStatus {
  disabled = 1,
  sharing,
  observing,
  no_state,
}

interface MultiUsersState {
  status: MultiUsersStatus,
  username: string,
  state_id: string,
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
    private multiUsersState: WatchableValue<MultiUsersState>
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
        db.collection('users').doc(state_id).set({
          [editor]: false,
          [this.otherUsername]: true,
        }, { merge: true });
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

  private userItems = new Map<String, MultiUsersTabItem>();
  private prevStateGeneration: number | undefined;
  private throttledUpdateStateToFirebase: () => void;
  private stateListenerDetach: () => void;
  private usersListenerDetach: () => void;

  private multiUsersState = new WatchableValue<MultiUsersState>({
    username: "",
    state_id: "",
    editor: "",
    usernames: [],
    status: MultiUsersStatus.no_state,
  });

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

  private stateUpdated() {
    /* A large sized state will cause an error when trying to save it to firestore, DK78 full segmentation is 8,626,688.
    Mysql size = 9,276,778
    A typical state size is ID=523
    The max is 1,048,576 bytes, so we need to check the size of the state before saving it to firestore
    ID=945 is 1,138,722 in 
    */
    if (userState.value !== null) {
      if (userState.value.id === 0) {
        // Detach user change listener
        if (this.usersListenerDetach !== undefined) {
          this.usersListenerDetach();
        }
      }
      else {
        if (brainState.value !== null) {
          const username = String(userState.value.username);
          const state_id = String(brainState.value.id);
          this.throttledUpdateStateToFirebase = debounce(() => {
            const cacheState = getCachedJson(this.viewerState);
            const { generation, value } = cacheState;
            if (generation !== this.prevStateGeneration) {
              this.prevStateGeneration = cacheState.generation;
              console.log('state size');
              let s = JSON.stringify(value);
              console.log(s.length);
              db.collection('states').doc(state_id).set(value)
                .catch(error => {
                  StatusMessage.showTemporaryMessage("Error, the data is too big " + error, 10000);
                  console.error('Error writing document: ', error);
                }
                );

            }
          }, 10)

          // Listen for users change
          const userDocRef = db.collection('users').doc(state_id);
          this.usersListenerDetach = userDocRef.onSnapshot((doc) => {
            const data = doc.data();
            if (data !== undefined && Object.keys(data).length !== 0) {
              const editors = Object.keys(data).filter(
                key => data[key]
              );
              const editor = editors.length > 0 ? editors[0] : "";
              const usernames = Object.keys(data);

              const status = usernames.includes(username) ? (
                editor === username ? MultiUsersStatus.sharing
                  : MultiUsersStatus.observing
              ) : MultiUsersStatus.disabled

              this.multiUsersState.value = {
                status,
                username,
                state_id,
                editor,
                usernames,
              }
            }
            else {
              this.multiUsersState.value = {
                status: MultiUsersStatus.disabled,
                username,
                state_id,
                editor: "",
                usernames: [],
              }
            }
            this.multiUsersState.changed.dispatch();
          });
        }
      }
    }
  }

  private multiUsersStateUpdated() {
    this.updateHeaderAndListener();
    this.updateUserItems();
  }

  private updateHeaderAndListener() {
    const { status, username, state_id, editor } = this.multiUsersState.value;

    // Remove any listener if any
    this.viewerState.changed.remove(this.throttledUpdateStateToFirebase);
    if (this.stateListenerDetach !== undefined) {
      this.stateListenerDetach();
    }

    let headerTextContent = "";
    let actionButtonDisplay = "";
    let actionButtonTextContent = "";
    let actionButtonOnclick = () => { };
    if (status === MultiUsersStatus.disabled) {
      // Update UI
      const header_editor = editor === "" ? "No one" : editor;
      headerTextContent = header_editor + " is sharing";
      actionButtonDisplay = "block";
      actionButtonTextContent = editor === "" ? "Share" : "Observe";
      actionButtonOnclick = () => {
        db.collection('users').doc(state_id).set({
          [username]: editor === "" ? true : false
        }, { merge: true });
      };
    }
    else if (status === MultiUsersStatus.sharing) {
      // Add state change listener
      this.viewerState.changed.add(this.throttledUpdateStateToFirebase);

      // Update UI
      headerTextContent = "You are sharing";
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        db.collection('users').doc(state_id).delete();
      };
    }
    else if (status === MultiUsersStatus.observing) {
      // Listen for state change from firestore
      this.stateListenerDetach = db.collection('states').doc(state_id)
        .onSnapshot((doc) => {
          const data = doc.data();
          if (data !== undefined) {
            this.viewerState.restoreState(verifyObject(data));
          }
        });

      // Update UI
      headerTextContent = "You are observing " + editor;
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        // Remove yourself from the list
        db.collection('users').doc(state_id).set({
          [username]: firebase.firestore.FieldValue.delete()
        }, { merge: true });
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
}