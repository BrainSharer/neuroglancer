// The stylesheet is provided by the bundler; TypeScript does not have a
// declaration for CSS-only side-effect imports.
// @ts-expect-error CSS is resolved at build time.
import "#src/ui/layer_side_panel.css";



import type { SidePanelManager } from "#src/ui/side_panel.js";
import { SidePanel } from "#src/ui/side_panel.js";
import { Tab, TabView } from "#src/widget/tab_view.js";
import { makeIcon } from "#src/widget/icon.js";
import { CachedWatchableValue, WatchableValue } from "#src/trackable_value.js";
import type { 
  SidePanelLocation} from "#src/ui/side_panel_location.js";
import { 
  DEFAULT_SIDE_PANEL_LOCATION, 
  TrackableSidePanelLocation 
} from "#src/ui/side_panel_location.js";
import { NullarySignal, Signal } from "#src/util/signal.js";
import { MultiUsersTab } from "#src/brainshare/multi_users_tab.js";
import type { Trackable } from "#src/util/trackable.js";
import { StateTab  } from "#src/brainshare/state_tab.js";
import { APIs } from "#src/brainshare/service.js";
import { brainState, userState} from "#src/brainshare/state_utils.js";
import { emptyToUndefined } from "#src/util/json.js";
import svg_exit from "ikonate/icons/exit.svg?raw";
import svg_entrance from "ikonate/icons/entrance.svg?raw";
import svg_language from "ikonate/icons/language.svg?raw";
import { NeuroglancerLog } from "#src/brainshare/types.js";
import { StatusMessage } from '#src/status.js';

const REST_ROWS_ENDPOINT = APIs.GET_SET_NOTES;

//type RestRow = Record<string, unknown>;
type RestRow = NeuroglancerLog

/**
 * Tab that lists rows from a REST endpoint and provides a small create-row
 * form.  The table is intentionally schema-agnostic so the backend can add
 * fields without requiring a TypeScript change.
 */
class NeuroglancerLogsTab extends Tab {
  private readonly tableContainer = document.createElement("div");
  private readonly statusElement = document.createElement("div");
  private readonly noteInput = document.createElement("textarea");
  private readonly createButton = document.createElement("button");
  private readonly refreshButton = document.createElement("button");
  private rows: RestRow[] = [];
  private loading = false;
  private stateID: number = 0;

  constructor() {
    super();
    this.buildUI();
    brainState.changed.add(() => {
      if (brainState.value !== null) {
        this.stateID = brainState.value.id;
        console.log('Setting stateID to ' + this.stateID);
        this.loadRows();
      }
    });
  }

  private buildUI() {
    this.element.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      padding: 10px;
      gap: 10px;
      overflow: hidden;
    `;

    const heading = document.createElement("div");
    // heading.textContent = "LogsXXX";
    heading.style.cssText = "font-weight: 600; font-size: 14px;";

    const form = document.createElement("form");
    form.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border: 1px solid var(--neuroglancer-panel-border-color, #555);
      border-radius: 4px;
      flex: 0 0 auto;
    `;
    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Note";
    this.noteInput.rows = 2;
    this.noteInput.style.width = "100%";
    this.noteInput.style.boxSizing = "border-box";
    noteLabel.appendChild(this.noteInput);

    const formActions = document.createElement("div");
    formActions.style.cssText = "display:flex; gap:6px; align-items:center;";

    this.createButton.type = "submit";
    this.createButton.textContent = "Add note";
    formActions.append(this.createButton);
    form.append(noteLabel, formActions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.createRow();
    });

    this.statusElement.style.cssText = "font-size:12px; min-height:16px; opacity:.8;";

    this.tableContainer.style.cssText = `
      flex: 1 1 auto;
      min-height: 0;
      height: 250px;
      overflow-y: auto;
    `;

    this.element.append(heading, form, this.statusElement, this.tableContainer);
  }

  private setStatus(message: string, isError = false) {
    this.statusElement.textContent = message;
    this.statusElement.style.opacity = isError ? "1" : ".8";
  }

  private async loadRows() {
    if (this.loading) return;
    if (this.stateID === 0) return;
    this.loading = true;
    this.refreshButton.disabled = true;
    this.setStatus("Loading…");

  if (!brainState.value || !userState.value) {
    console.error("Brain or user state is not defined.");
    StatusMessage.showTemporaryMessage("Cannot fetch notes, brain and/or user state is missing.", 5000);
    return;
  }



    try {
      const url = new URL(REST_ROWS_ENDPOINT);
      url.searchParams.append("state_id", this.stateID.toString());
      console.log(`Fetching rows from ${url.toString()}`);
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userState.value.access}`},

      });

      if (!response.ok) {
        throw new Error(`GET ${REST_ROWS_ENDPOINT} failed (${response.status})`);
      }

      const payload = await response.json();
      const neuroglancer_log = payload['results'] as NeuroglancerLog[];
      console.log(neuroglancer_log);
      if (Array.isArray(neuroglancer_log)) {
        this.rows = neuroglancer_log.filter((row: unknown): row is RestRow =>
          row !== null && typeof row === "object" && !Array.isArray(row));
      } else if (
        neuroglancer_log !== null &&
        typeof neuroglancer_log === "object" &&
        Array.isArray((neuroglancer_log as { rows?: unknown }).rows)
      ) {
        this.rows = (neuroglancer_log as { rows: unknown[] }).rows.filter(
          (row): row is RestRow =>
            row !== null && typeof row === "object" && !Array.isArray(row),
        );
      } else {
        throw new Error("REST response must be an array or an object containing a rows array");
      }

      this.renderRows();
      this.setStatus(`${this.rows.length} row${this.rows.length === 1 ? "" : "s"}`);
    } catch (error) {
      this.rows = [];
      this.renderRows();
      this.setStatus(error instanceof Error ? error.message : "Failed to load rows", true);
    } finally {
      this.loading = false;
      this.refreshButton.disabled = false;
    }
  }

  private async createRow() {
    // const username = this.usernameInput.value.trim();
    const note = this.noteInput.value.trim();

    this.createButton.disabled = true;
    this.setStatus("Creating…");

  if (!brainState.value || !userState.value) {
    console.error("Brain or user state is not defined.");
    StatusMessage.showTemporaryMessage("Cannot create a note, brain and/or user state is missing.", 5000);
    return;
  }


    try {
      const row: RestRow = {
        owner: userState.value.id,
        note: note,
        state: brainState.value.id
      };

      const response = await fetch(REST_ROWS_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          'Authorization': `Bearer ${userState.value.access}`,
        },
        body: JSON.stringify(row),
      });

      if (!response.ok) {
        throw new Error(`POST ${REST_ROWS_ENDPOINT} failed (${response.status})`);
      }

      this.noteInput.value = "";

      // Prefer the backend-created row when it returns one, then refresh so
      // the displayed data exactly matches the server.
      await this.loadRows();
      if (!this.loading) this.setStatus("Row created");
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Failed to create row", true);
    } finally {
      this.createButton.disabled = false;
    }
  }

  private renderRows() {
    this.tableContainer.replaceChildren();

    if (this.rows.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No notes found.";
      empty.style.cssText = "padding:12px 4px; opacity:.7;";
      this.tableContainer.appendChild(empty);
      return;
    }

    const columns = ["id", "created", "note", "username"] as Array<keyof RestRow>;

    const table = document.createElement("table");
    table.style.cssText = "width:100%; border-collapse:collapse; font-size:12px;";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const column of columns) {
      const th = document.createElement("th");
      th.textContent = column.toUpperCase();
      th.style.cssText =
        "position:sticky; top:0; text-align:left; padding:6px; border-bottom:1px solid #777; background:var(--neuroglancer-panel-background, #222);";
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tr = document.createElement("tr");
      for (const column of columns) {
        console.log(`Rendering column ${String(column)} for row`, row);
        const td = document.createElement("td");
        const value = row[column];
        td.textContent =
          value === null || value === undefined
            ? ""
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value);
        if (column === "created" && typeof value === "string") {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            td.textContent = date.toLocaleString();
          }
        }
        td.style.cssText =
          "padding:6px; vertical-align:top; border-bottom:1px solid rgba(128,128,128,.3); word-break:break-word;";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    this.tableContainer.appendChild(table);
  }
}

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
    this.tabs = ['User', 'Multi-Users', 'Logs'];
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
  neuroglancerLogsTab: NeuroglancerLogsTab;

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
    this.neuroglancerLogsTab = new NeuroglancerLogsTab();
    this.tabView = new TabView(
      {
        makeTab: (id) => {
          if (id === "User") {
            return this.stateTab;
          }
          else if (id === "Multi-Users") {
            return this.multiUsersTab;
          }
          else if (id === "Logs") {
            return this.neuroglancerLogsTab;
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
      } else {
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