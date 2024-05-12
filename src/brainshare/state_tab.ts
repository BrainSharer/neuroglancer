import "./state_tab.css"

import { Trackable, getCachedJson } from "#/util/trackable";
import { StatusMessage } from "#/status";
import { makeIcon } from "#/widget/icon";
import { Tab } from "#/widget/tab_view";
import { verifyObject } from '#/util/json';
import { StateAPI } from "./state_utils";

/**
 * This class takes care of the buttons and inputs used by the user
 * to load a specific Neuroglancer state.
 * topnav bar
 */
export class StateTab extends Tab {
  private comment = document.createElement("input");
  private buttonContainer = document.createElement("div");
  private newButton = makeIcon({
    text: 'New',
    title: 'Save to a new JSON state'
  });
  private saveButton = makeIcon({
    text: 'Save',
    title: 'Save to the current JSON state'
  });
  private loadButton = makeIcon({
    text: 'Load',
    title: 'Load the JSON state stored in the database',
  });

  constructor(
    private viewerState: Trackable,
    private stateAPI: StateAPI,
  ) {
    super();

    this.init_ui();

    this.stateAPI.userState.changed.add(() => {
      this.stateUpdated();
    });
    this.stateAPI.brainState.changed.add(() => {
      this.stateUpdated();
    });
  }

  private init_ui() {
    this.element.classList.add("neuroglancer-state-tab-container");
    this.comment.classList.add("neuroglancer-state-tab-comment");
    this.buttonContainer.classList.add(
      "neuroglancer-state-tab-button-container"
    );

    this.comment.type = "text";
    this.comment.placeholder = 'Type comments here';

    // New button
    this.registerEventListener(this.newButton, 'click', () => {
      const comments = this.comment.value;
      if (comments.length === 0) {
        StatusMessage.showTemporaryMessage(
          'Error: the comment cannot be empty.'
        );
        return;
      }

      const userState = this.stateAPI.userState.value;
      if (userState !== null) {
        const newBrainstate = {
          owner: userState.id,
          comments: comments,
          user_date: String(Date.now()),
          neuroglancer_state: getCachedJson(this.viewerState).value,
          readonly: false,
          public: true,
          lab: userState.lab
        };
        this.stateAPI.newState(newBrainstate);
      }
    });

    // Save button
    this.saveButton.style.display = 'none';
    this.registerEventListener(this.saveButton, 'click', () => {
      const comments = this.comment.value;
      if (comments.length === 0) {
        StatusMessage.showTemporaryMessage(
          'There was an error: the comment cannot be empty.'
        );
        return;
      }

      const brainState = this.stateAPI.brainState.value;
      const userState = this.stateAPI.userState.value;
      if (brainState !== null && userState !== null) {
        const newBrainState = {
          comments: comments,
          user_date: String(Date.now()),
          neuroglancer_state: getCachedJson(this.viewerState).value,
        };
        this.stateAPI.saveState(brainState.id, newBrainState);
      }
    });

    // Reset button
    this.loadButton.style.display = 'none;'
    this.registerEventListener(this.loadButton, 'click', () => {
      this.load_viewerState();
    });

    this.element.appendChild(this.comment);
    this.element.appendChild(this.buttonContainer);
    this.buttonContainer.appendChild(this.newButton);
    this.buttonContainer.appendChild(this.saveButton);
    this.buttonContainer.appendChild(this.loadButton);
  }

  private load_viewerState() {
    const brainState = this.stateAPI.brainState.value;
    if (brainState !== null) {
      this.viewerState.reset();
      this.viewerState.restoreState(verifyObject(brainState.neuroglancer_state));
    }
  }

  private stateUpdated() {
    const userState = this.stateAPI.userState.value;
    if (userState !== null) {
      if (userState.id !== 0) {
        const brainState = this.stateAPI.brainState.value;
        if (brainState !== null) {
          this.comment.value = brainState['comments'];
          this.saveButton.style.removeProperty('display');
          this.loadButton.style.removeProperty('display');

          if ((brainState.readonly) || (brainState.lab !== userState.lab)) {
            this.saveButton.style.removeProperty('display');
            this.saveButton.style.display = 'none';
          }
        }
      }
    }
  }
}