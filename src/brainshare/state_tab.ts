import { Trackable, getCachedJson } from "#/util/trackable";
import { StatusMessage } from "#/status";
import { makeIcon } from "#/widget/icon";
import { Tab } from "#/widget/tab_view";
import { verifyObject } from '#/util/json';
import { StateAPI, StateAutocomplete } from "./state_utils";
import { APIs } from "./service";

/**
 * This class takes care of the buttons and inputs used by the user
 * to load a specific Neuroglancer state.
 * topnav bar
 */
export class StateTab extends Tab {
  private input: StateAutocomplete;
  private newButton: HTMLElement;
  private saveButton: HTMLElement;
  private resetButton: HTMLElement;
  private portalButton: HTMLElement;

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
      this.init_viewerState();
      this.stateUpdated();
    });
  }

  private init_viewerState() {
    const brainState = this.stateAPI.brainState.value;
    if (brainState !== null) {
      this.viewerState.reset();
      this.viewerState.restoreState(verifyObject(brainState.neuroglancer_state));
    }
  }

  private stateUpdated() {
    const userState = this.stateAPI.userState.value;
    if (userState !== null) {
      if (userState.user_id === 0) {
        this.element.style.display = "none";
      }
      else {
        this.element.style.display = "block";
        const brainState = this.stateAPI.brainState.value;
        if (brainState !== null) {
          this.input.value = brainState['comments'];
          this.saveButton.style.removeProperty('display');
          this.resetButton.style.removeProperty('display');

          if ((brainState.readonly) || (brainState.lab !== userState.lab)) {
            this.saveButton.style.removeProperty('display');
            this.saveButton.style.display = 'none';
          }
        }
      }
    }
  }

  private init_ui() {
    const brainState = this.stateAPI.brainState.value;
    const userState = this.stateAPI.userState.value;
    this.element.classList.add("neuroglancer-state-tab-container");

    // Autocomplete
    this.input = new StateAutocomplete(this.viewerState);
    this.input.disableCompletions();
    this.input.value = 'Type URL name here';
    this.element.appendChild(this.input.element);

    // New button
    this.newButton = makeIcon({
      text: 'New',
      title: 'Save to a new JSON state'
    });
    this.registerEventListener(this.newButton, 'click', () => {
      const comments = this.input.value;
      if (comments.length === 0) {
        StatusMessage.showTemporaryMessage(
          'Error: the comment cannot be empty.'
        );
        return;
      }

      if (brainState !== null && userState !== null) {
        const newBrainstate = {
          state_id: brainState.state_id,
          owner: userState.user_id,
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
    this.element.appendChild(this.newButton);

    // Save button
    this.saveButton = makeIcon({
      text: 'Save',
      title: 'Save to the current JSON state'
    });
    this.registerEventListener(this.saveButton, 'click', () => {
      const comments = this.input.value;
      if (comments.length === 0) {
        StatusMessage.showTemporaryMessage(
          'There was an error: the comment cannot be empty.'
        );
        return;
      }

      if (brainState !== null && userState !== null) {
        const newBrainState = {
          state_id: brainState.state_id,
          owner: userState.user_id,
          comments: comments,
          user_date: String(Date.now()),
          neuroglancer_state: getCachedJson(this.viewerState).value,
          readonly: false,
          public: true,
          lab: userState.lab
        };
        this.stateAPI.saveState(brainState.state_id, newBrainState);
      }
    });
    this.saveButton.style.display = 'none';
    this.element.appendChild(this.saveButton);

    // Reset button
    this.resetButton = makeIcon({
      text: 'Reset',
      title: 'Reset to the JSON state stored in the database',
    });
    this.registerEventListener(this.resetButton, 'click', () => {
      console.log('reset clicked');
    });
    this.resetButton.style.display = 'none;'
    this.element.appendChild(this.resetButton);

    // Portal button
    this.portalButton = makeIcon({
      text: 'Portal',
      title: 'Admin Portal'
    });
    this.registerEventListener(this.portalButton, 'click', () => {
      window.location.href = `${APIs.ADMIN_PORTAL}`;
    });
    this.element.appendChild(this.portalButton);
  }
}