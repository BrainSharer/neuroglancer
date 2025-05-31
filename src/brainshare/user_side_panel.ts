import "#src/ui/layer_side_panel.css";



import { SidePanel, SidePanelManager } from "#src/ui/side_panel.js";
import { Tab, TabView } from "#src/widget/tab_view.js";
import { makeIcon } from "#src/widget/icon.js";
import { CachedWatchableValue, WatchableValue } from "#src/trackable_value.js";
import { 
  DEFAULT_SIDE_PANEL_LOCATION, 
  SidePanelLocation, 
  TrackableSidePanelLocation 
} from "#src/ui/side_panel_location.js";
import { NullarySignal, Signal } from "#src/util/signal.js";
import { MultiUsersTab } from "#src/brainshare/multi_users_tab.js";
import { Trackable } from "#src/util/trackable.js";
import { StateTab  } from "#src/brainshare/state_tab.js";
import { APIs } from "#src/brainshare/service.js";
import { userState } from "#src/brainshare/state_utils.js";
import { emptyToUndefined } from "#src/util/json.js";
import svg_exit from "ikonate/icons/exit.svg?raw";
import svg_entrance from "ikonate/icons/entrance.svg?raw";
import svg_language from "ikonate/icons/language.svg?raw";


const DEFAULT_USER_SIDE_PANEL_LOCATION: SidePanelLocation = {
  ...DEFAULT_SIDE_PANEL_LOCATION,
  side: "left",
  row: 0,
  visible: true,
}

export class UserSidePanelState implements Trackable {
  changed = new NullarySignal();
  location = new TrackableSidePanelLocation(DEFAULT_USER_SIDE_PANEL_LOCATION);
  tabsChanged = new Signal();
  selectedTab = new WatchableValue<string | undefined>(undefined);
  explicitTabs: Set<string> | undefined;
  tabs: string[];

  constructor() {
    this.tabs = ['User', 'Multi-Users'];
    this.selectedTab.value = 'User';

    this.tabsChanged.add(() => {
      this.changed.dispatch();
    });
    this.selectedTab.changed.add(() => {
      this.changed.dispatch();
    });

    this.location.changed.add(() => {
      this.changed.dispatch();
    });
    this.location.locationChanged.add(() => {
      this.changed.dispatch();
    });
  }

  restoreState(obj: unknown) {
    if (obj === undefined) return;
    if (obj === null || typeof obj !== "object") return;
    if ("tab" in obj && typeof obj["tab"] == "string") 
      this.selectedTab.value = obj["tab"];
    if ("location" in obj) 
      this.location.restoreState(obj["location"]);
  }

  toJSON() {
    const obj: any = {
      "tab": this.selectedTab.value,
      "location": this.location.toJSON(),
    }
    return emptyToUndefined(obj);
  }

  reset() {
    this.selectedTab.value = "User";
    this.location.reset();
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
    svg: svg_language,
    title: "admin portal",
  });

  tabView: TabView;
  stateTab: StateTab;
  multiUsersTab: MultiUsersTab;

  constructor(
    sidePanelManager: SidePanelManager,
    private panelState: UserSidePanelState,
    private viewerState: Trackable
  ) {
    super(sidePanelManager, panelState.location);

    this.init_ui();

    userState.changed.add(() => {
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
    this.stateTab = new StateTab(this.viewerState);
    this.multiUsersTab = new MultiUsersTab(this.viewerState);
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
    this.addBody(this.tabView.element);
  }

  private stateUpdated() {
    if (userState.value !== null) {
      if (userState.value.id === 0) {
        if (this.titleElement !== undefined) {
          this.titleElement.textContent = "Please log in";
        }
        this.loginButton.style.display = "block";
        this.logoutButton.style.display = "none";
        this.tabView.element.style.display = "none"
      }
      else {
        if (this.titleElement !== undefined) {
          this.titleElement.textContent = userState.value.username;
        }
        this.loginButton.style.display = "none";
        this.logoutButton.style.display = "block";
        this.tabView.element.style.display = "block"
      }
    }
  }
}