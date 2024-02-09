import "#/ui/layer_side_panel.css";

import svg_exit from "ikonate/icons/exit.svg";
import svg_entrance from "ikonate/icons/entrance.svg";

import { SidePanel, SidePanelManager } from "#/ui/side_panel";
import { Tab, TabView } from "#/widget/tab_view";
import { makeIcon } from "#/widget/icon";
import { CachedWatchableValue, WatchableValue } from "#/trackable_value";
import { RefCounted } from "#/util/disposable";
import { TrackableSidePanelLocation } from "#/ui/side_panel_location";
import { Signal } from "#/util/signal";
import { LAYER_SIDE_PANEL_DEFAULT_LOCATION } from "#/ui/layer_side_panel_state";
import { MultiUsersTab } from "./multi_users_tab";
import { Trackable } from "#/util/trackable";
import { StateTab  } from "./state_tab";
import { APIs } from "./service";
import { StateAPI } from "./state_utils";


export class UserSidePanelState extends RefCounted {
  location = new TrackableSidePanelLocation(LAYER_SIDE_PANEL_DEFAULT_LOCATION);
  tabsChanged = new Signal();
  selectedTab = new WatchableValue<string | undefined>(undefined);
  explicitTabs: Set<string> | undefined;
  tabs: string[];

  constructor() {
    super()
    this.tabs = ['User', 'Multi-Users'];
    this.selectedTab.value = 'User';

    this.tabsChanged.add(() => {
      console.log('tabChanged');
    });
    this.selectedTab.changed.add(() => {
      console.log('selectedTab.changed');
    });

    this.location.changed.add(() => {
      console.log('localtion.changed');
    });
    this.location.locationChanged.add(() => {
      console.log('localtion.localtionChanged');
      if (this.location.visible) return;
    });
  }
}

export class UserSidePanel extends SidePanel {
  titleBar: HTMLElement;
  titleElement: HTMLElement | undefined;
  loginButton: HTMLElement;
  logoutButton: HTMLElement;
  tabView: TabView;
  stateTab: StateTab;
  multiUsersTab: MultiUsersTab;

  stateAPI: StateAPI;

  constructor(
    sidePanelManager: SidePanelManager,
    private panelState: UserSidePanelState,
    private viewerState: Trackable
  ) {
    super(sidePanelManager, panelState.location);

    this.stateAPI = new StateAPI(`${APIs.API_ENDPOINT}/neuroglancer`);

    this.init_ui();

    this.stateAPI.userState.changed.add(() => {
      this.update();
    });

    this.update();
  }

  private update() {
    const userState = this.stateAPI.userState.value;
    if (userState !== null) {
      if (userState.user_id === 0) {
        if (this.titleElement !== undefined) {
          this.titleElement.textContent = "Please log in";
        }
        this.loginButton.style.display = "block";
        this.logoutButton.style.display = "none";
        this.tabView.element.style.display = "none"
      }
      else {
        if (this.titleElement !== undefined) {
          this.titleElement.textContent = userState.username;
        }
        this.loginButton.style.display = "none";
        this.logoutButton.style.display = "block";
        this.tabView.element.style.display = "block"
      }
    }
  }

  private init_ui() {
    const panelState = this.panelState;

    // Titlebar
    const { titleBar, titleElement } = this.addTitleBar({
      title: "User Panel"
    });
    this.titleBar = titleBar;
    this.titleElement = titleElement;

    // loginButton
    this.loginButton = makeIcon({
      svg: svg_entrance,
      title: "login",
    });
    this.registerEventListener(this.loginButton, "click", () => {
      window.location.href = APIs.LOCAL_LOGIN;
    });
    this.titleBar.appendChild(this.loginButton);

    // logoutButton
    this.logoutButton = makeIcon({
      svg: svg_exit,
      title: "logout",
    });
    this.registerEventListener(this.logoutButton, "click", () => {
      window.location.href = APIs.LOGOUT;
    });
    this.titleBar.appendChild(this.logoutButton);

    // TabView
    this.stateTab = new StateTab(this.viewerState, this.stateAPI);
    this.multiUsersTab = new MultiUsersTab(this.viewerState, this.stateAPI);
    this.tabView = new TabView(
      {
        makeTab: (id) => {
          if (id === "User") {
            return this.stateTab;
          }
          else if (id === "Multi-Users") {
            return this.multiUsersTab;
          }
          else {
            return new Tab();
          }
        },
        selectedTab: panelState.selectedTab,
        tabs: this.registerDisposer(new CachedWatchableValue({
          get value() {
            return panelState.tabs.map((id) => {
              return {
                id,
                label: id,
                hidden: false,
              };
            });
          },
          changed: panelState.tabsChanged,
        })),
        handleTabElement: (id: string, element: HTMLElement) => {
          console.log("handleTabElement", id, element);
        },
      },
      this.visibility,
    );
    this.tabView.element.style.flex = "1";
    this.tabView.element.classList.add(
      "neuroglancer-layer-side-panel-tab-view",
    );
    this.tabView.element.style.position = "relative";
    this.addBody(this.tabView.element);
  }
}