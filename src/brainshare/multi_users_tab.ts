import "./multi_users_tab.css";

import debounce from "lodash/debounce";
import svg_swap_horizontal from "ikonate/icons/swap-horizontal.svg";
import { RefCounted } from "#/util/disposable";
import { getCachedJson, Trackable } from "#/util/trackable";
import { makeIcon } from "#/widget/icon";
import { Tab } from "#/widget/tab_view";
import { WatchableValue } from "#/trackable_value";
import { brainState, userState, upsertCouchState, deleteCouchDbDocument, upsertCouchUser, fetchUserRevision, CouchUserDocument } from "./state_utils";
import { verifyObject } from "src/util/json";
import { listenToDocumentChanges } from "./db_nano";
import { couchStateUrl, couchUserUrl } from "./service";

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
        upsertCouchUser(state_id, editor, [this.otherUsername])        
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
  private currentUserDoc: CouchUserDocument | undefined;

  private multiUsersState = new WatchableValue<MultiUsersState>({
    state_id: "",
    username: "",
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

    if (userState.value !== null) {
      if (userState.value.id === 0) {
        // Detach user change listener
        if (this.usersListenerDetach !== undefined) {
          this.usersListenerDetach();
        }
      } else {
        if (brainState.value !== null) {
          const username = String(userState.value.username);
          const state_id = String(brainState.value.id);
          this.throttledUpdateStateToFirebase = debounce(() => {
            const cacheState = getCachedJson(this.viewerState);
            const { generation, value } = cacheState;
            if (generation !== this.prevStateGeneration) {
              console.log('stateUpdated, generation !== this.prevStateGeneration')
              this.prevStateGeneration = cacheState.generation;
              upsertCouchState(state_id, value)
            }
          }, 10);

          fetchUserRevision(state_id).then((doc) => {
            this.currentUserDoc = doc;
            if (this.currentUserDoc === undefined) {
              this.multiUsersState.value = {
                status: MultiUsersStatus.disabled,
                state_id,
                username,
                editor: "",
                usernames: [],
              }
            } else {
              console.log('user doc', this.currentUserDoc);
              const editor = this.currentUserDoc.editor;
              let usernames = this.currentUserDoc.otherUsers;
              if (usernames === undefined) {
                usernames = [username]
              } else {
                usernames.push(username);
              }

              const status = usernames?.includes(username) ? (
                editor === username ? MultiUsersStatus.sharing
                  : MultiUsersStatus.observing
              ) : MultiUsersStatus.disabled;

              this.multiUsersState.value = {
                status,
                state_id,
                username,
                editor,
                usernames,
              };
            }
            this.multiUsersState.changed.dispatch();
          }).catch((err) => {
            console.error('Error fetching user revision:', err);
          });

        } else { console.log('brainState.value === null'); }
      }
    } else { console.log('userState.value === null'); }
  }

  private multiUsersStateUpdated() {
    this.updateHeaderAndListener();
    this.updateUserItems();
  }

  private updateHeaderAndListener() {
    console.log('updateHeaderAndListener method');
    const { status, state_id, editor, usernames } = this.multiUsersState.value;

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
        /**
        db.collection('users').doc(state_id).set({
          [username]: editor === "" ? true : false
        }, { merge: true });
        */
        const editing = editor === "" ? true : false;
        console.log('219 upsertCouchUser stateid ' + state_id + ' editor ' + editor + ' editing ' + editing + ' usernames ' + usernames);
        upsertCouchUser(state_id, editor, usernames);
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
        // db.collection('users').doc(state_id).delete();
        deleteCouchDbDocument(couchUserUrl, state_id);
        console.log('deleting entry')
      };
    }
    else if (status === MultiUsersStatus.observing) {
      //TODO check for changes in neuroglancer state from couchdb, if changed, update
      const data = undefined;
      if (data !== undefined) {
        this.viewerState.restoreState(verifyObject(data));
      }
      // Update UI
      headerTextContent = "You are observing " + editor;
      actionButtonDisplay = "block";
      actionButtonTextContent = "Stop";
      actionButtonOnclick = () => {
        console.log('fix me');
        /** 
        // Remove yourself from the list
        db.collection('users').doc(state_id).set({
          [username]: firebase.firestore.FieldValue.delete()
        }, { merge: true });
        */
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
    console.log('updateUserItems', usernames);
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