import "#/ui/layer_side_panel.css";

import svg_exit from "ikonate/icons/exit.svg";
import svg_entrance from "ikonate/icons/entrance.svg";
import svg_controls from "ikonate/icons/controls.svg";

import { SidePanel, SidePanelManager } from "#/ui/side_panel";
import { Tab, TabView } from "#/widget/tab_view";
import { makeIcon } from "#/widget/icon";
import { CachedWatchableValue, WatchableValue } from "#/trackable_value";
import { RefCounted } from "#/util/disposable";
import { 
  DEFAULT_SIDE_PANEL_LOCATION, 
  SidePanelLocation, 
  TrackableSidePanelLocation 
} from "#/ui/side_panel_location";
import { Signal } from "#/util/signal";
import { MultiUsersTab } from "./multi_users_tab";
import { Trackable } from "#/util/trackable";
import { StateTab  } from "./state_tab";
import { APIs } from "./service";
import { StateAPI } from "./state_utils";

const DEFAULT_USER_SIDE_PANEL_LOCATION: SidePanelLocation = {
  ...DEFAULT_SIDE_PANEL_LOCATION,
  side: "left",
  row: 0,
  visible: true,
}

export class UserSidePanelState extends RefCounted {
  location = new TrackableSidePanelLocation(DEFAULT_USER_SIDE_PANEL_LOCATION);
  tabsChanged = new Signal();
  selectedTab = new WatchableValue<string | undefined>(undefined);
  explicitTabs: Set<string> | undefined;
  tabs: string[];

  constructor() {
    super()
    this.tabs = ['User', 'Multi-Users'];
    this.selectedTab.value = 'User';

    this.tabsChanged.add(() => {
    });
    this.selectedTab.changed.add(() => {
    });

    this.location.changed.add(() => {
    });
    this.location.locationChanged.add(() => {
    });
  }
}

export class UserSidePanel extends SidePanel {
  titleBar: HTMLElement;
  titleElement: HTMLElement | undefined;
  loginButton = makeIcon({
    svg: svg_entrance,
    title: "login",
  });
  logoutButton = makeIcon({
    svg: svg_exit,
    title: "logout",
  });
  portalButton = makeIcon({
    svg: svg_controls,
    title: "admin portal",
  });

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
      this.stateUpdated();
    });

    this.stateUpdated();
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
    this.registerEventListener(this.loginButton, "click", () => {
      window.location.href = APIs.LOCAL_LOGIN;
    });
    this.titleBar.appendChild(this.loginButton);

    // logoutButton
    this.registerEventListener(this.logoutButton, "click", () => {
      window.location.href = APIs.LOGOUT;
    });
    this.titleBar.appendChild(this.logoutButton);

    // portalButton
    this.registerEventListener(this.portalButton, "click", () => {
      window.location.href = APIs.ADMIN_PORTAL;
    });
    this.titleBar.appendChild(this.portalButton);

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

  private stateUpdated() {
    const userState = this.stateAPI.userState.value;
    if (userState !== null) {
      if (userState.id === 0) {
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
}