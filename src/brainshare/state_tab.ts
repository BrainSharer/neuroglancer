import "./state_tab.css"

import { Trackable, getCachedJson } from "#src/util/trackable.js";
import { StatusMessage } from "#src/status.js";
import { makeIcon } from "#src/widget/icon.js";
import { Tab } from "#src/widget/tab_view.js";
import { verifyObject } from "#src/util/json.js";
import { 
  State, 
  brainState, 
  newState, 
  saveState, 
  userState 
} from "#src/brainshare/state_utils.js";

const displayKeys = new Set([
  "user", 
  "lab", 
  "animal", 
  "public", 
  "readonly", 
  "created", 
  "updated",
]);

/**
 * This class takes care of the buttons and inputs used by the user
 * to load a specific Neuroglancer state.
 * topnav bar
 */
export class StateTab extends Tab {
  constructor(
    private viewerState: Trackable,
  ) {
    super();

    this.element.classList.add("neuroglancer-state-tab-container");
    this.element.style.height = "100%"
    this.render();

    userState.changed.add(() => {
      this.render();
    });
    brainState.changed.add(() => {
      this.render();
    });
  }

  private render() {
    this.element.innerHTML = "";

    if (userState.value === null || userState.value.id === 0) return;

    const titlebarDiv = document.createElement("div");
    titlebarDiv.classList.add("neuroglancer-state-tab-titlebar");
    this.element.appendChild(titlebarDiv);

    const titleDiv = document.createElement("div");
    titleDiv.classList.add("neuroglancer-state-tab-title");
    titleDiv.textContent = "No brain selected"
    titlebarDiv.appendChild(titleDiv);
    const buttonGroupDiv = document.createElement("div");
    titlebarDiv.appendChild(buttonGroupDiv);

    const newButton = makeIcon({
      text: "New",
      title: "Save to a new JSON state"
    });
    this.registerEventListener(newButton, "click", () => {
      const comments = commentTextarea.value;
      if (comments.length === 0) {
        StatusMessage.showTemporaryMessage(
          "Error: the comment cannot be empty."
        );
        return;
      }

      if (userState.value !== null) {
        const newBrainstate = {
          owner: userState.value.id,
          comments: comments,
          user_date: String(Date.now()),
          neuroglancer_state: getCachedJson(this.viewerState).value,
          readonly: false,
          public: true,
          lab: userState.value.lab
        };
        newState(newBrainstate);
      }
    });
    buttonGroupDiv.appendChild(newButton);

    if (brainState.value) {
      titleDiv.textContent = `Brain ID: ${brainState.value["id"]}`
      
      const saveButton = makeIcon({
        text: "Save",
        title: "Save to the current JSON state"
      });
      this.registerEventListener(saveButton, "click", () => {
        const comments = commentTextarea.value;
        if (comments.length === 0) {
          StatusMessage.showTemporaryMessage(
            "There was an error: the comment cannot be empty."
          );
          return;
        }

        if (brainState.value !== null && userState.value !== null) {
          const newBrainState = {
            comments: comments,
            user_date: String(Date.now()),
            neuroglancer_state: getCachedJson(this.viewerState).value,
          };
          saveState(brainState.value.id, newBrainState);
        }
      });
      buttonGroupDiv.appendChild(saveButton);

      const loadButton = makeIcon({
        text: "Load",
        title: "Load the JSON state stored in the database",
      });
      this.registerEventListener(loadButton, "click", () => {
        if (brainState.value !== null) {
          this.viewerState.reset();
          this.viewerState.restoreState(verifyObject(
            brainState.value.neuroglancer_state
          ));
        }
      });
      buttonGroupDiv.appendChild(loadButton);

      let key: keyof State;
      for (key in brainState.value) {
        if (!displayKeys.has(key)) continue;
        const stateRowDiv = document.createElement("div");
        stateRowDiv.classList.add("neuroglancer-state-tab-state-row");
        const keyDiv = document.createElement("div");
        keyDiv.style.color = "#FFFF66"
        keyDiv.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        stateRowDiv.appendChild(keyDiv);

        const valueDiv = document.createElement("div");
        const value = brainState.value[key];
        if (typeof(value) !== "object") {
          valueDiv.textContent = formatStateString(value);
        }
        stateRowDiv.appendChild(valueDiv);
        this.element.appendChild(stateRowDiv);
      }  
    }

    const stateRowDiv = document.createElement("div");
    stateRowDiv.classList.add("neuroglancer-state-tab-state-row");
    stateRowDiv.style.marginTop = "10px"
    this.element.appendChild(stateRowDiv);
    const keyDiv = document.createElement("div");
    keyDiv.style.color = "#FFFF66"
    keyDiv.textContent = "Comments";
    stateRowDiv.appendChild(keyDiv);

    const commentTextarea = document.createElement("textarea");
    commentTextarea.classList.add("neuroglancer-state-tab-comment");
    commentTextarea.placeholder = "Enter comments here";
    commentTextarea.rows = 3;
    this.element.appendChild(commentTextarea);
    if (brainState.value) {
      commentTextarea.value = brainState.value["comments"];
    }
  }
}

function formatStateString(value: string | number | boolean): string {
  if (typeof(value) === "number") return value.toString();
  if (typeof(value) === "boolean") return ["No", "Yes"][Number(value)];

  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return value;
  }
  else {
    const date = new Date(time);
    return date.toLocaleDateString();
  }
}