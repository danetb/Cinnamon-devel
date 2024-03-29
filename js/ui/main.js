// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/**
 * FILE:main.js
 * @automountManager (AutomountManager.AutomountManager): The automount manager
 * @placesManager (PlacesManager.PlacesManager): The places manager
 * @overview (Overview.Overview): The "scale" overview 
 * @expo (Expo.Expo): The "expo" overview
 * @runDialog (RunDialog.RunDialog): The run dialog
 * @lookingGlass (LookingGlass.LookingGlass): The looking glass
 * @wm (WindowManager.WindowManager): The window manager
 * @messageTray (MessageTray.MessageTray): The mesesage tray
 * @notificationDaemon (NotificationDaemon.NotificationDaemon): The notification daemon
 * @windowAttentionHandler (WindowAttentionHandler.WindowAttentionHandler): The window attention handler
 * @recorder (Cinnamon.Recorder): The recorder
 * @cinnamonDBusService (CinnamonDBus.Cinnamon): The cinnamon dbus object
 * @modalCount (int): The number of modals "pushed"
 * @modalActorFocusStack (array): Array of pushed modal actors
 * @uiGroup (Cinnamon.GenericContainer): The group containing all Cinnamon
 *                                       and Muffin actors
 * @magnifier (Magnifier.Magnifier): The magnifier
 * @xdndHandler (XdndHandler.XdndHandler): The X DND handler
 * @statusIconDispatcher (StatusIconDispatcher.StatusIconDispatcher): The status icon dispatcher
 * @keyboard (Keyboard.Keyboard): The keyboard object
 * @layoutManager (Layout.LayoutManager): The layout manager
 * @themeManager (ThemeManager.ThemeManager): The theme manager
 * @dynamicWorkspaces (boolean): Whether dynamic workspaces are to be used.
 *                               This is not yet implemented
 * @nWorks (int): Number of workspaces
 * @tracker (Cinnamon.WindowTracker): The window tracker
 * @workspace_names (array): Names of workspace
 * @background (null): Unused
 * @deskletContainer (DeskletManager.DeskletContainer): The desklet container 
 * @software_rendering (boolean): Whether software rendering is used
 * @lg_log_file (Gio.FileOutputStream): The stream used to log looking messages
 *                                      to ~/.cinnamon/glass.log
 * @can_log (boolean): Whether looking glass log to file can be used
 *
 * The main file is responsible for launching Cinnamon as well as creating its components. Most components of Cinnamon can be accessed through main
 */

const Clutter = imports.gi.Clutter;
const DBus= imports.dbus;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const PointerTracker = imports.misc.pointerTracker;

const SoundManager = imports.ui.soundManager;
const BackgroundManager = imports.ui.backgroundManager;
const AppletManager = imports.ui.appletManager;
const AutomountManager = imports.ui.automountManager;
const DeskletManager = imports.ui.deskletManager;
const ExtensionSystem = imports.ui.extensionSystem;
const Keyboard = imports.ui.keyboard;
const MessageTray = imports.ui.messageTray;
const Overview = imports.ui.overview;
const Expo = imports.ui.expo;
const PlacesManager = imports.ui.placesManager;
const RunDialog = imports.ui.runDialog;
const Layout = imports.ui.layout;
const LookingGlass = imports.ui.lookingGlass;
const NotificationDaemon = imports.ui.notificationDaemon;
const WindowAttentionHandler = imports.ui.windowAttentionHandler;
const Scripting = imports.ui.scripting;
const CinnamonDBus = imports.ui.cinnamonDBus;
const LookingGlassDBus = imports.ui.lookingGlassDBus;
const WindowManager = imports.ui.windowManager;
const ThemeManager = imports.ui.themeManager;
const Magnifier = imports.ui.magnifier;
const XdndHandler = imports.ui.xdndHandler;
const StatusIconDispatcher = imports.ui.statusIconDispatcher;
const Util = imports.misc.util;
const Keybindings = imports.ui.keybindings;
const Settings = imports.ui.settings;

const DEFAULT_BACKGROUND_COLOR = new Clutter.Color();
DEFAULT_BACKGROUND_COLOR.from_pixel(0x2266bbff);


let automountManager = null;

let soundManager = null;
let backgroundManager = null;
let placesManager = null;
let overview = null;
let expo = null;
let runDialog = null;
let lookingGlass = null;
let wm = null;
let messageTray = null;
let notificationDaemon = null;
let windowAttentionHandler = null;
let recorder = null;
let cinnamonDBusService = null;
let lookingGlassDBusService = null;
let modalCount = 0;
let modalActorFocusStack = [];
let uiGroup = null;
let magnifier = null;
let xdndHandler = null;
let statusIconDispatcher = null;
let keyboard = null;
let layoutManager = null;
let themeManager = null;
let keybindingManager = null;
let _errorLogStack = [];
let _startDate;
let _defaultCssStylesheet = null;
let _cssStylesheet = null;
let dynamicWorkspaces = null;
let nWorks = null;
let tracker = null;
let settingsManager = null;

let workspace_names = [];

let background = null;

let deskletContainer = null;
let software_rendering = false;

let lg_log_file;
let can_log = false;

// Override Gettext localization
const Gettext = imports.gettext;
Gettext.bindtextdomain('cinnamon', '/usr/share/cinnamon/locale');
Gettext.textdomain('cinnamon');
const _ = Gettext.gettext;

// backward-compatibility hack:
__defineGetter__("panel", function() { return layoutManager.panel; });
__defineGetter__("panel2", function() { return layoutManager.panel2; });

function _initRecorder() {
    let recorderSettings = new Gio.Settings({ schema: 'org.cinnamon.recorder' });

    global.screen.connect('toggle-recording', function() {
        if (recorder == null) {
            recorder = new Cinnamon.Recorder({ stage: global.stage });
        }

        if (recorder.is_recording()) {
            recorder.pause();
            Meta.enable_unredirect_for_screen(global.screen);
        } else {
            // read the parameters from GSettings always in case they have changed
            recorder.set_framerate(recorderSettings.get_int('framerate'));
            recorder.set_filename('cinnamon-%d%u-%c.' + recorderSettings.get_string('file-extension'));
            let pipeline = recorderSettings.get_string('pipeline');

            if (!pipeline.match(/^\s*$/))
                recorder.set_pipeline(pipeline);
            else
                recorder.set_pipeline(null);

            Meta.disable_unredirect_for_screen(global.screen);
            recorder.record();
        }
    });
}

let _numberOfWorkspaceRows = 1;
let _workspaceRowsTopDown = true;

function getNumberOfWorkspaceRows() {
    return _numberOfWorkspaceRows;
}
/*
 * Calculates the current workspace geometry, based on the current number
 * of workspace.
 * 
 * @return [num-columns, num-rows]
 */
function getWorkspaceGeometry() {
    let nWorkspaces = global.screen.n_workspaces;
    let nColumns = Math.ceil(nWorkspaces / _numberOfWorkspaceRows);
    let nRows = Math.floor((nWorkspaces-1) / nColumns) + 1;
    return [nColumns, nRows];
}

function getWorkspaceRowsTopDown() {
    return _workspaceRowsTopDown;
}

function _initUserSession() {
    _initRecorder();

    let setupWorkspaceLayout = function() {
        let enabled = global.settings.get_boolean('multiple-workspace-rows-enabled') || false;
        _workspaceRowsTopDown = !enabled ? true : global.settings.get_boolean('workspace-rows-top-down');
        _numberOfWorkspaceRows = !enabled ? 1 : (global.settings.get_int('number-workspace-rows') || 2);
        global.screen.override_workspace_layout(
            getWorkspaceRowsTopDown() ? Meta.ScreenCorner.TOPLEFT : Meta.ScreenCorner.BOTTOMLEFT, false, _numberOfWorkspaceRows, -1);
    };
    global.settings.connect('changed::number-workspace-rows', setupWorkspaceLayout);
    global.settings.connect('changed::multiple-workspace-rows-enabled', setupWorkspaceLayout);
    global.settings.connect('changed::workspace-rows-top-down', setupWorkspaceLayout);

    setupWorkspaceLayout();
    ExtensionSystem.init();

    Meta.keybindings_set_custom_handler('panel-run-dialog', function() {
       getRunDialog().open();
    });

    Meta.keybindings_set_custom_handler('panel-main-menu', function () {
        expo.toggle();
    });
    
}

function _reparentActor(actor, newParent) {
    let parent = actor.get_parent();
    if (parent)
      parent.remove_actor(actor);
    if(newParent)
        newParent.add_actor(actor);
}

/**
 * start:
 *
 * Starts cinnamon. Should not be called in JavaScript code
 */
function start() {
    global.reparentActor = _reparentActor;

    // Monkey patch utility functions into the global proxy;
    // This is easier and faster than indirecting down into global
    // if we want to call back up into JS.
    global.logTrace = _logTrace;
    global.logWarning = _logWarning;
    global.logError = _logError;
    global.log = _logInfo;

    if (global.settings.get_boolean("enable-looking-glass-logs")) {
        try {
            let log_filename = Gio.file_parse_name(CIN_LOG_FOLDER + '/glass.log');
            let log_backup_filename = Gio.file_parse_name(CIN_LOG_FOLDER + '/glass.log.last');
            let log_dir = Gio.file_new_for_path(CIN_LOG_FOLDER);
            if (!log_filename.query_exists(null)) {
                if (!log_dir.query_exists(null))
                    log_dir.make_directory_with_parents(null);
                lg_log_file = log_filename.append_to(0, null);
            } else {
                log_filename.copy(log_backup_filename, 1, null, null, null);
                log_filename.delete(null);
                lg_log_file = log_filename.append_to(0, null);
            }
            can_log = true;
        } catch (e) {
            global.logError("Error during looking-glass log initialization", e);
        }
    }

    log("About to start Cinnamon");
    if (GLib.getenv('CINNAMON_SOFTWARE_RENDERING')) {
        log("ACTIVATING SOFTWARE RENDERING");        
        global.logError("Cinnamon Software Rendering mode enabled");
        software_rendering = true;
    }

    // Chain up async errors reported from C
    global.connect('notify-error', function (global, msg, detail) { notifyError(msg, detail); });    

    Gio.DesktopAppInfo.set_desktop_env('GNOME');

    cinnamonDBusService = new CinnamonDBus.Cinnamon();
    lookingGlassDBusService = new LookingGlassDBus.CinnamonLookingGlass();
    // Force a connection now; dbus.js will do this internally
    // if we use its name acquisition stuff but we aren't right
    // now; to do so we'd need to convert from its async calls
    // back into sync ones.
    DBus.session.flush();

    // Ensure CinnamonWindowTracker and CinnamonAppUsage are initialized; this will
    // also initialize CinnamonAppSystem first.  CinnamonAppSystem
    // needs to load all the .desktop files, and CinnamonWindowTracker
    // will use those to associate with windows.  Right now
    // the Monitor doesn't listen for installed app changes
    // and recalculate application associations, so to avoid
    // races for now we initialize it here.  It's better to
    // be predictable anyways.
    tracker = Cinnamon.WindowTracker.get_default();
    Cinnamon.AppSystem.get_default();

    // The stage is always covered so Clutter doesn't need to clear it; however
    // the color is used as the default contents for the Muffin root background
    // actor so set it anyways.
    global.stage.color = DEFAULT_BACKGROUND_COLOR;
    global.stage.no_clear_hint = true;

    Gtk.IconTheme.get_default().append_search_path("/usr/share/cinnamon/icons/");
    _defaultCssStylesheet = global.datadir + '/theme/cinnamon.css';    

    soundManager = new SoundManager.SoundManager();

    themeManager = new ThemeManager.ThemeManager();

    settingsManager = new Settings.SettingsManager();

    backgroundManager = new BackgroundManager.BackgroundManager();
    
    deskletContainer = new DeskletManager.DeskletContainer();

    // Set up stage hierarchy to group all UI actors under one container.
    uiGroup = new Cinnamon.GenericContainer({ name: 'uiGroup' });
    uiGroup.connect('allocate',
                    function (actor, box, flags) {
                        let children = uiGroup.get_children();
                        for (let i = 0; i < children.length; i++)
                            children[i].allocate_preferred_size(flags);
                    });
    St.set_ui_root(global.stage, uiGroup);

    global.reparentActor(global.background_actor, uiGroup);
    global.reparentActor(global.bottom_window_group, uiGroup);
    uiGroup.add_actor(deskletContainer.actor);
    global.reparentActor(global.window_group, uiGroup);
    global.reparentActor(global.overlay_group, uiGroup);

    global.stage.add_actor(uiGroup);
    global.reparentActor(global.top_window_group, global.stage);

    layoutManager = new Layout.LayoutManager();
    let pointerTracker = new PointerTracker.PointerTracker();
    pointerTracker.setPosition(layoutManager.primaryMonitor.x + layoutManager.primaryMonitor.width/2, 
        layoutManager.primaryMonitor.y + layoutManager.primaryMonitor.height/2);

    xdndHandler = new XdndHandler.XdndHandler();
    // This overview object is just a stub for non-user sessions
    overview = new Overview.Overview();
    expo = new Expo.Expo();
    magnifier = new Magnifier.Magnifier();
    statusIconDispatcher = new StatusIconDispatcher.StatusIconDispatcher();  
    wm = new WindowManager.WindowManager();
    messageTray = new MessageTray.MessageTray();
    keyboard = new Keyboard.Keyboard();
    notificationDaemon = new NotificationDaemon.NotificationDaemon();
    windowAttentionHandler = new WindowAttentionHandler.WindowAttentionHandler();

    placesManager = new PlacesManager.PlacesManager();    
    automountManager = new AutomountManager.AutomountManager();

    keybindingManager = new Keybindings.KeybindingManager();

    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, _checkWorkspaces);

    nWorks = global.settings.get_int("number-workspaces");
    dynamicWorkspaces = false; // This should be configurable

    if (!dynamicWorkspaces) {
        _staticWorkspaces();
    }
    
    layoutManager.init();
    keyboard.init();
    overview.init();
    expo.init();

    _initUserSession();
    statusIconDispatcher.start(layoutManager.panel.actor);

    // Provide the bus object for gnome-session to
    // initiate logouts.
    //EndSessionDialog.init();

    _startDate = new Date();

    global.stage.connect('captured-event', _globalKeyPressHandler);

    global.log('loaded at ' + _startDate);
    log('Cinnamon started at ' + _startDate);

    let perfModuleName = GLib.getenv("CINNAMON_PERF_MODULE");
    if (perfModuleName) {
        let perfOutput = GLib.getenv("CINNAMON_PERF_OUTPUT");
        let module = eval('imports.perf.' + perfModuleName + ';');
        Scripting.runPerfScript(module, perfOutput);
    }
    
    workspace_names = global.settings.get_strv("workspace-name-overrides");  

    global.screen.connect('notify::n-workspaces', _nWorkspacesChanged);

    global.screen.connect('window-entered-monitor', _windowEnteredMonitor);
    global.screen.connect('window-left-monitor', _windowLeftMonitor);
    global.screen.connect('restacked', _windowsRestacked);

    _nWorkspacesChanged();

    AppletManager.init();
    DeskletManager.init();

    if (software_rendering && !GLib.getenv('CINNAMON_2D')) {
        notifyCinnamon2d();
    }
}

function notifyCinnamon2d() {
    let icon = new St.Icon({ icon_name: 'display',
                             icon_type: St.IconType.FULLCOLOR,
                             icon_size: 36 });
    criticalNotify(_("Running in software rendering mode"),
                   _("Cinnamon is currently running without video hardware acceleration and, as a result, you may observe much higher than normal CPU usage.\n\n") +
                   _("There could be a problem with your drivers or some other issue.  For the best experience, it is recommended that you only use this mode for") +
                   _(" troubleshooting purposes."), icon);
}

function loadSoundSettings() {


}

function enablePanels() {
    layoutManager.enablePanels();
}

function disablePanels() {
    layoutManager.disablePanels();
}

function getPanels() {
    let panels = [];
    if(panel)
        panels.push(panel);
    if(panel2)
        panels.push(panel2);
    return panels;
}

let _workspaces = [];
let _checkWorkspacesId = 0;

/*
 * When the last window closed on a workspace is a dialog or splash
 * screen, we assume that it might be an initial window shown before
 * the main window of an application, and give the app a grace period
 * where it can map another window before we remove the workspace.
 */
const LAST_WINDOW_GRACE_TIME = 1000;

function _fillWorkspaceNames(index) {
    // ensure that we have workspace names up to index
    for (let i = index - workspace_names.length; i > 0; --i) {
        workspace_names.push('');
    }
}

function _trimWorkspaceNames(index) {
    // trim empty or out-of-bounds names from the end.
    for (let i = workspace_names.length - 1;
            i >= 0 && (i >= nWorks || !workspace_names[i].length); --i)
    {
        workspace_names.pop();
    }
}

function _makeDefaultWorkspaceName(index) {
    if (true || _numberOfWorkspaceRows < 2) {
        return _("WORKSPACE %s").format(index + 1);
    }
    else {
        let numCols = Math.ceil(global.screen.n_workspaces / _numberOfWorkspaceRows);
        let row = Math.floor(index / numCols) + 1;
        let col = (index % numCols) + 1;
        return _("WORKSPACE %s:%s").format(row, col);
    }
}

/**
 * setWorkspaceName:
 * @index (int): index of workspace
 * @name (string): name of workspace
 *
 * Sets the name of the workspace @index to @name
 */
function setWorkspaceName(index, name) {
    name.trim();
    if (name != getWorkspaceName(index)) {
        _fillWorkspaceNames(index);
        workspace_names[index] = (name == _makeDefaultWorkspaceName(index) ?
            "" :
            name);
        _trimWorkspaceNames();
        global.settings.set_strv("workspace-name-overrides", workspace_names);
    }
}

/**
 * getWorkspaceName:
 * @index (int): index of workspace
 *
 * Retrieves the name of the workspace @index
 *
 * Returns (string): name of workspace
 */
function getWorkspaceName(index) {
    let wsName = index < workspace_names.length ?
        workspace_names[index] :
        "";
    wsName.trim();
    return wsName.length > 0 ?
        wsName :
        _makeDefaultWorkspaceName(index);
}

/**
 * hasDefaultWorkspaceName:
 * @index (int): index of workspace
 *
 * Whether the workspace uses the default name
 *
 * Returns (boolean): whether the workspace uses the default name
 */
function hasDefaultWorkspaceName(index) {
    return getWorkspaceName(index) == _makeDefaultWorkspaceName(index);
}

function _addWorkspace() {
    if (dynamicWorkspaces)
        return false;
    nWorks++;
    global.settings.set_int("number-workspaces", nWorks);
    _staticWorkspaces();
    return true;
}

function _removeWorkspace(workspace) {
    if (nWorks == 1 || dynamicWorkspaces)
        return false;
    nWorks--;
    let index = workspace.index();
    if (index < workspace_names.length) {
        workspace_names.splice (index,1);
    }
    _trimWorkspaceNames();
    global.settings.set_strv("workspace-name-overrides", workspace_names);
    global.settings.set_int("number-workspaces", nWorks);
    global.screen.remove_workspace(workspace, global.get_current_time());
    return true;
}

/**
 * moveWindowToNewWorkspace:
 * @metaWindow (Meta.Window): the window to be moved
 * @switchToNewWorkspace (boolean): whether or not to switch to the
 *                                  new created workspace
 *
 * Moves the window to a new workspace.
 *
 * If @switchToNewWorkspace is true, it will switch to the new workspace
 * after moving the window
 */
function moveWindowToNewWorkspace(metaWindow, switchToNewWorkspace) {
    if (switchToNewWorkspace) {
        let targetCount = global.screen.n_workspaces + 1;
        let nnwId = global.screen.connect('notify::n-workspaces', function() {
            global.screen.disconnect(nnwId);
            if (global.screen.n_workspaces === targetCount) {
                let newWs = global.screen.get_workspace_by_index(global.screen.n_workspaces - 1);
                newWs.activate(global.get_current_time());
            }
        });
    }
    metaWindow.change_workspace_by_index(global.screen.n_workspaces, true, global.get_current_time());
}

function _staticWorkspaces() {
    let i;
    let dif = nWorks - global.screen.n_workspaces;
    if (dif > 0) {
        for (let i = 0; i < dif; i++)
            global.screen.append_new_workspace(false, global.get_current_time());
    } else {
        if (nWorks == 0)
            return false;
        for (let i = 0; i > dif; i--){
            let removeWorkspaceIndex = global.screen.n_workspaces - 1;
            let removeWorkspace = global.screen.get_workspace_by_index(removeWorkspaceIndex);
            let lastRemoved = removeWorkspace._lastRemovedWindow;
            global.screen.remove_workspace(removeWorkspace, global.get_current_time()); 
        }    
    }
    return true;
}

function _checkWorkspaces() {
    if (!dynamicWorkspaces)
        return false;
    let i;
    let emptyWorkspaces = [];

    for (let i = 0; i < _workspaces.length; i++) {
        let lastRemoved = _workspaces[i]._lastRemovedWindow;
        if (lastRemoved &&
            (lastRemoved.get_window_type() == Meta.WindowType.SPLASHSCREEN ||
             lastRemoved.get_window_type() == Meta.WindowType.DIALOG ||
             lastRemoved.get_window_type() == Meta.WindowType.MODAL_DIALOG))
                emptyWorkspaces[i] = false;
        else
            emptyWorkspaces[i] = true;
    }

    let windows = global.get_window_actors();
    for (let i = 0; i < windows.length; i++) {
        let win = windows[i];

        if (win.get_meta_window().is_on_all_workspaces())
            continue;

        let workspaceIndex = win.get_workspace();
        emptyWorkspaces[workspaceIndex] = false;
    }

    // If we don't have an empty workspace at the end, add one
    if (!emptyWorkspaces[emptyWorkspaces.length -1]) {
        global.screen.append_new_workspace(false, global.get_current_time());
        emptyWorkspaces.push(false);
    }

    let activeWorkspaceIndex = global.screen.get_active_workspace_index();
    let removingCurrentWorkspace = (emptyWorkspaces[activeWorkspaceIndex] &&
                                    activeWorkspaceIndex < emptyWorkspaces.length - 1);
    // Don't enter the overview when removing multiple empty workspaces at startup
    let showOverview  = (removingCurrentWorkspace &&
                         !emptyWorkspaces.every(function(x) { return x; }));

    if (removingCurrentWorkspace) {
        // "Merge" the empty workspace we are removing with the one at the end
        wm.blockAnimations();
    }

    // Delete other empty workspaces; do it from the end to avoid index changes
    for (let i = emptyWorkspaces.length - 2; i >= 0; i--) {
        if (emptyWorkspaces[i])
            global.screen.remove_workspace(_workspaces[i], global.get_current_time());
    }

    if (removingCurrentWorkspace) {
        global.screen.get_workspace_by_index(global.screen.n_workspaces - 1).activate(global.get_current_time());
        wm.unblockAnimations();
    }

    _checkWorkspacesId = 0;
    return false;
}

function _windowRemoved(workspace, window) {
    workspace._lastRemovedWindow = window;
    _queueCheckWorkspaces();
    Mainloop.timeout_add(LAST_WINDOW_GRACE_TIME, function() {
        if (workspace._lastRemovedWindow == window) {
            workspace._lastRemovedWindow = null;
            _queueCheckWorkspaces();
        }
    });
}

function _windowLeftMonitor(metaScreen, monitorIndex, metaWin) {
    // If the window left the primary monitor, that
    // might make that workspace empty
    if (monitorIndex == layoutManager.primaryIndex)
        _queueCheckWorkspaces();
}

function _windowEnteredMonitor(metaScreen, monitorIndex, metaWin) {
    // If the window entered the primary monitor, that
    // might make that workspace non-empty
    if (monitorIndex == layoutManager.primaryIndex)
        _queueCheckWorkspaces();
}

function _windowsRestacked() {
    // Figure out where the pointer is in case we lost track of
    // it during a grab. (In particular, if a trayicon popup menu
    // is dismissed, see if we need to close the message tray.)
    global.sync_pointer();
}

function _queueCheckWorkspaces() {
    if (!dynamicWorkspaces)
        return false;
    if (_checkWorkspacesId == 0)
        _checkWorkspacesId = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, _checkWorkspaces);
    return true;
}

function _nWorkspacesChanged() {
    nWorks = global.screen.n_workspaces;
    if (!dynamicWorkspaces)
        return false;

    let oldNumWorkspaces = _workspaces.length;
    let newNumWorkspaces = global.screen.n_workspaces;

    if (oldNumWorkspaces == newNumWorkspaces)
        return false;

    let lostWorkspaces = [];
    if (newNumWorkspaces > oldNumWorkspaces) {
        // Assume workspaces are only added at the end
        for (let w = oldNumWorkspaces; w < newNumWorkspaces; w++)
            _workspaces[w] = global.screen.get_workspace_by_index(w);

        for (let w = oldNumWorkspaces; w < newNumWorkspaces; w++) {
            let workspace = _workspaces[w];
            workspace._windowAddedId = workspace.connect('window-added', _queueCheckWorkspaces);
            workspace._windowRemovedId = workspace.connect('window-removed', _windowRemoved);
        }

    } else {
        // Assume workspaces are only removed sequentially
        // (e.g. 2,3,4 - not 2,4,7)
        let removedIndex;
        let removedNum = oldNumWorkspaces - newNumWorkspaces;
        for (let w = 0; w < oldNumWorkspaces; w++) {
            let workspace = global.screen.get_workspace_by_index(w);
            if (_workspaces[w] != workspace) {
                removedIndex = w;
                break;
            }
        }

        let lostWorkspaces = _workspaces.splice(removedIndex, removedNum);
        lostWorkspaces.forEach(function(workspace) {
                                   workspace.disconnect(workspace._windowAddedId);
                                   workspace.disconnect(workspace._windowRemovedId);
                               });
    }

    _queueCheckWorkspaces();

    return false;
}

/**
 * getThemeStylesheet:
 *
 * Get the theme CSS file that Cinnamon will load
 *
 * Returns (string): A file path that contains the theme CSS,
 *                   null if using the default
 */
function getThemeStylesheet()
{
    return _cssStylesheet;
}

/**
 * setThemeStylesheet:
 * @cssStylesheet (string): A file path that contains the theme CSS,
 *                         set it to null to use the default
 *
 * Set the theme CSS file that Cinnamon will load
 */
function setThemeStylesheet(cssStylesheet)
{
    _cssStylesheet = cssStylesheet;
}

/**
 * loadTheme:
 *
 * Reloads the theme CSS file
 */
function loadTheme() {
    let themeContext = St.ThemeContext.get_for_stage (global.stage);
    let theme = new St.Theme ();
    let stylesheetLoaded = false;
    if (_cssStylesheet != null) {
        stylesheetLoaded = theme.load_stylesheet(_cssStylesheet);
    }
    if (!stylesheetLoaded) {
        theme.load_stylesheet(_defaultCssStylesheet);
        if (_cssStylesheet != null) {
            global.logError("There was some problem parsing the theme: " + _cssStylesheet + ".  Falling back to the default theme.");
        }
    }

    themeContext.set_theme (theme);
}

/**
 * notify:
 * @msg (string): A message
 * @details (string): Additional information to be
 *
 * Sends a notification
 */
function notify(msg, details) {
    let source = new MessageTray.SystemNotificationSource();
    messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details);
    notification.setTransient(true);
    source.notify(notification);
}

/**
 * criticalNotify:
 * @msg: A critical message
 * @details: Additional information
 */
function criticalNotify(msg, details, icon) {
    let source = new MessageTray.SystemNotificationSource();
    messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details, { icon: icon });
    notification.setTransient(true);
    notification.setUrgency(MessageTray.Urgency.CRITICAL);
    source.notify(notification);
}

/**
 * notifyError:
 * @msg (string): An error message
 * @details (string): Additional information
 *
 * See cinnamon_global_notify_problem().
 */
function notifyError(msg, details) {
    // Also print to stderr so it's logged somewhere
    if (details)
        log('error: ' + msg + ': ' + details);
    else
        log('error: ' + msg);
    notify(msg, details);
}

/**
 * _log:
 * @category (string): string message type ('info', 'error')
 * @msg (string): A message string
 * @...: Any further arguments are converted into JSON notation,
 *       and appended to the log message, separated by spaces.
 *
 * Log a message into the LookingGlass error
 * stream.  This is primarily intended for use by the
 * extension system as well as debugging.
 */
function _log(category, msg) {
    let text = msg;
    if (arguments.length > 2) {
        text += ': ';
        for (let i = 2; i < arguments.length; i++) {
            text += JSON.stringify(arguments[i]);
            if (i < arguments.length - 1)
                text += ' ';
        }
    }
    let out = {timestamp: new Date().getTime().toString(),
                         category: category,
                         message: text };
    _errorLogStack.push(out);
    if(lookingGlassDBusService)
        lookingGlassDBusService.emitLogUpdate();
    if (can_log) lg_log_file.write(renderLogLine(out), null);
}

/**
 * isError:
 * @obj (Object): the object to be tested
 * 
 * Tests whether @obj is an error object
 * 
 * Returns (boolean): whether @obj is an error object
 */
function isError(obj) {
    return typeof(obj) == 'object' && 'message' in obj && 'stack' in obj;
}

/**
 * _LogTraceFormatted:
 * @stack (string): the stack trace
 * 
 * Prints the stack trace to the LookingGlass
 * error stream in a predefined format
 */
function _LogTraceFormatted(stack) {
    _log('trace', '\n<----------------\n' + stack + '---------------->');
}

/**
 * _logTrace:
 * @msg (Error): An error object
 *
 * Prints a stack trace of the given object.
 *
 * If msg is an error, its stack-trace will be
 * printed. Otherwise, a stack-trace of the call
 * will be generated
 *
 * If you want to print the message of an Error
 * as well, use the other log functions instead.
 */
function _logTrace(msg) {
    if(isError(msg)) {
        _LogTraceFormatted(msg.stack);
    } else {
        try {
            throw new Error();
        } catch (e) {
            // e.stack must have at least two lines, with the first being
            // _logTrace() (which we strip off), and the second being
            // our caller.
            let trace = e.stack.substr(e.stack.indexOf('\n') + 1);
            _LogTraceFormatted(trace);
        }
    }
}

/**
 * _logWarning:
 * @msg (Error/string): An error object or the message string
 *
 * Logs the message to the LookingGlass error
 * stream.
 *
 * If msg is an error, its stack-trace will be
 * printed.
 */
function _logWarning(msg) {
    if(isError(msg)) {
        _log('warning', msg.message);
        _LogTraceFormatted(msg.stack);
    } else {
        _log('warning', msg);
    }
}

/**
 * _logError:
 * @msg (string): (optional) The message string
 * @error (Error): (optional) The error object
 * 
 * Logs the following (if present) to the
 * LookingGlass error stream:
 * - The message from the error object
 * - The stack trace of the error object
 * - The message @msg
 * 
 * It can be called in the form of either _logError(msg),
 * _logError(error) or _logError(msg, error).
 */
function _logError(msg, error) {
    if(error && isError(error)) {
        _log('error', error.message);
        _LogTraceFormatted(error.stack);
        _log('error', msg);
    } else if(isError(msg)) {
        _log('error', msg.message);
        _LogTraceFormatted(msg.stack);
    } else {
        _log('error', msg);
    }
}

// If msg is an Error, its message will be printed as 'info' and its stack-trace will be printed as 'trace'
/**
 * _logInfo:
 * @msg (Error/string): The error object or the message string
 * 
 * Logs the message to the LookingGlass
 * error stream. If @msg is an Error object, 
 * its stack trace will also be printed
 */

function _logInfo(msg) {
    if(isError(msg)) {
        _log('info', msg.message);
        _LogTraceFormatted(msg.stack);
    } else {
        _log('info', msg);
    }
}

/**
 * formatTime:
 * @d (Date): date object to be formatted
 *
 * Formats a date object into a ISO-8601 format (YYYY-MM-DDTHH:MM:SSZ) in UTC+0
 *
 * Returns (string): a formatted string showing the date
 */
function formatTime(d) {
    return d.toISOString();
}

/**
 * renderLogLine:
 * @line (dictionary): a log line
 * 
 * Converts a log line object into a string
 *
 * Returns (string): line in the format CATEGORY t=TIME MESSAGE
 */
function renderLogLine(line) {
    return line.category + ' t=' + formatTime(new Date(parseInt(line.timestamp))) + ' ' + line.message + '\n';
}

/**
 * logStackTrace:
 * @msg (string): message
 *
 * Logs the message @msg to stdout with backtrace
 */
function logStackTrace(msg) {
    try {
        throw new Error();
    } catch (e) {
        // e.stack must have at least two lines, with the first being
        // logStackTrace() (which we strip off), and the second being
        // our caller.
        let trace = e.stack.substr(e.stack.indexOf('\n') + 1);
        log(msg ? (msg + '\n' + trace) : trace);
    }
}

/**
 * isWindowActorDisplayedOnWorkspace:
 * @win (Meta.WindowActor): window actor
 * @workspaceIndex (int): index of workspace
 *
 * Determines whether the window actor belongs to a specific workspace
 *
 * Returns (boolean): whether the window is on the workspace
 */
function isWindowActorDisplayedOnWorkspace(win, workspaceIndex) {
    if (win.get_workspace() == workspaceIndex) {return true;}
    let mwin = win.get_meta_window();
    return mwin && (mwin.is_on_all_workspaces() ||
        (wm.workspacesOnlyOnPrimary && mwin.get_monitor() != layoutManager.primaryIndex)
    );
}

/**
 * getWindowActorsForWorkspace:
 * @workspaceIndex (int): index of workspace
 *
 * Gets a list of actors on a workspace
 *
 * Returns (array): the array of window actors
 */
function getWindowActorsForWorkspace(workspaceIndex) {
    return global.get_window_actors().filter(function (win) {
        return isWindowActorDisplayedOnWorkspace(win, workspaceIndex);
    });
}

// This function encapsulates hacks to make certain global keybindings
// work even when we are in one of our modes where global keybindings
// are disabled with a global grab. (When there is a global grab, then
// all key events will be delivered to the stage, so ::captured-event
// on the stage can be used for global keybindings.)
function _globalKeyPressHandler(actor, event) {
    if (modalCount == 0)
        return false;
    if (event.type() != Clutter.EventType.KEY_PRESS)
        return false;

    let symbol = event.get_key_symbol();
    let keyCode = event.get_key_code();
    let modifierState = Cinnamon.get_event_state(event);

    // This relies on the fact that Clutter.ModifierType is the same as Gdk.ModifierType
    let action = global.display.get_keybinding_action(keyCode, modifierState);

    if (action == Meta.KeyBindingAction.CUSTOM) {
        global.display.keybinding_action_invoke_by_code(keyCode, modifierState);
    }

    // Other bindings are only available when the overview is up and no modal dialog is present
    if (((!overview.visible && !expo.visible) || modalCount > 1))
        return false;

    // This isn't a Meta.KeyBindingAction yet
    if (symbol == Clutter.Super_L || symbol == Clutter.Super_R) {
        overview.hide();
        expo.hide();
        return true;
    }
       
    if (action == Meta.KeyBindingAction.SWITCH_PANELS) {
        //Used to call the ctrlalttabmanager in Gnome Shell
        return true;
    }

    switch (action) {
         case Meta.KeyBindingAction.WORKSPACE_LEFT:
             wm.switchWorkspace('switch-to-workspace-left');
             return true;
         case Meta.KeyBindingAction.WORKSPACE_RIGHT:
             wm.switchWorkspace('switch-to-workspace-right');
             return true;
        case Meta.KeyBindingAction.WORKSPACE_UP:
             wm.switchWorkspace('switch-to-workspace-up');
            return true;
        case Meta.KeyBindingAction.WORKSPACE_DOWN:
             wm.switchWorkspace('switch-to-workspace-down');
            return true;
        case Meta.KeyBindingAction.PANEL_RUN_DIALOG:
        case Meta.KeyBindingAction.COMMAND_2:
            getRunDialog().open();
            return true;
        case Meta.KeyBindingAction.PANEL_MAIN_MENU:
            overview.hide();
            expo.hide();
            return true;
    }

    return false;
}

function _findModal(actor) {
    for (let i = 0; i < modalActorFocusStack.length; i++) {
        if (modalActorFocusStack[i].actor == actor)
            return i;
    }
    return -1;
}

/**
 * pushModal:
 * @actor (Clutter.Actor): actor which will be given keyboard focus
 * @timestamp (int): optional timestamp
 *
 * Ensure we are in a mode where all keyboard and mouse input goes to
 * the stage, and focus @actor. Multiple calls to this function act in
 * a stacking fashion; the effect will be undone when an equal number
 * of popModal() invocations have been made.
 *
 * Next, record the current Clutter keyboard focus on a stack. If the
 * modal stack returns to this actor, reset the focus to the actor
 * which was focused at the time pushModal() was invoked.
 *
 * @timestamp is optionally used to associate the call with a specific user
 * initiated event.  If not provided then the value of
 * global.get_current_time() is assumed.
 *
 * Returns (boolean): true iff we successfully acquired a grab or already had one
 */
function pushModal(actor, timestamp) {
    if (timestamp == undefined)
        timestamp = global.get_current_time();

    if (modalCount == 0) {
        if (!global.begin_modal(timestamp)) {
            log('pushModal: invocation of begin_modal failed');
            return false;
        }
        Meta.disable_unredirect_for_screen(global.screen);
    }

    global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);

    modalCount += 1;
    let actorDestroyId = actor.connect('destroy', function() {
        let index = _findModal(actor);
        if (index >= 0)
            popModal(actor);
    });

    let record = {
        actor: actor,
        focus: global.stage.get_key_focus(),
        destroyId: actorDestroyId
    };
    if (record.focus != null) {
        record.focusDestroyId = record.focus.connect('destroy', function() {
            record.focus = null;
            record.focusDestroyId = null;
        });
    }
    modalActorFocusStack.push(record);

    global.stage.set_key_focus(actor);
    return true;
}

/**
 * popModal:
 * @actor (Clutter.Actor): actor passed to original invocation of pushModal().
 * @timestamp (int): optional timestamp
 *
 * Reverse the effect of pushModal().  If this invocation is undoing
 * the topmost invocation, then the focus will be restored to the
 * previous focus at the time when pushModal() was invoked.
 *
 * @timestamp is optionally used to associate the call with a specific user
 * initiated event.  If not provided then the value of
 * global.get_current_time() is assumed.
 */
function popModal(actor, timestamp) {
    if (timestamp == undefined)
        timestamp = global.get_current_time();

    let focusIndex = _findModal(actor);
    if (focusIndex < 0) {
        global.stage.set_key_focus(null);
        global.end_modal(timestamp);
        global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);

        throw new Error('incorrect pop');
    }

    modalCount -= 1;

    let record = modalActorFocusStack[focusIndex];
    record.actor.disconnect(record.destroyId);

    if (focusIndex == modalActorFocusStack.length - 1) {
        if (record.focus)
            record.focus.disconnect(record.focusDestroyId);
        global.stage.set_key_focus(record.focus);
    } else {
        let t = modalActorFocusStack[modalActorFocusStack.length - 1];
        if (t.focus)
            t.focus.disconnect(t.focusDestroyId);
        // Remove from the middle, shift the focus chain up
        for (let i = modalActorFocusStack.length - 1; i > focusIndex; i--) {
            modalActorFocusStack[i].focus = modalActorFocusStack[i - 1].focus;
            modalActorFocusStack[i].focusDestroyId = modalActorFocusStack[i - 1].focusDestroyId;
        }
    }
    modalActorFocusStack.splice(focusIndex, 1);

    if (modalCount > 0)
        return;

    global.end_modal(timestamp);
    global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    Meta.enable_unredirect_for_screen(global.screen);
}

/**
 * createLookingGlass:
 *
 * Obtains the looking glass object. Create if it does not exist
 *
 * Returns (LookingGlass.LookingGlass): looking glass object
 */
function createLookingGlass() {
    if (lookingGlass == null) {
        lookingGlass = new LookingGlass.LookingGlass();
    }
    return lookingGlass;
}

/**
 * getRunDialog:
 *
 * Obtains the run dialog object. Create if it does not exist
 *
 * Returns (RunDialog.RunDialog): run dialog object
 */
function getRunDialog() {
    if (runDialog == null) {
        runDialog = new RunDialog.RunDialog();
    }
    return runDialog;
}

/**
 * activateWindow:
 * @window (Meta.Window): the Meta.Window to activate
 * @time (int): (optional) current event time
 * @workspaceNum (int): (optional) window's workspace number
 *
 * Activates @window, switching to its workspace first if necessary,
 * and switching out of the overview if it's currently active
 */
function activateWindow(window, time, workspaceNum) {
    let activeWorkspaceNum = global.screen.get_active_workspace_index();
    let windowWorkspaceNum = (workspaceNum !== undefined) ? workspaceNum : window.get_workspace().index();

    if (!time)
        time = global.get_current_time();

    if (windowWorkspaceNum != activeWorkspaceNum) {
        let workspace = global.screen.get_workspace_by_index(windowWorkspaceNum);
        workspace.activate_with_focus(window, time);
    } else {
        window.activate(time);
        Mainloop.idle_add(function() {
            window.foreach_transient(function(win) {
                win.activate(time);
            });
        });
    }

    overview.hide();
    expo.hide();
}

// TODO - replace this timeout with some system to guess when the user might
// be e.g. just reading the screen and not likely to interact.
const DEFERRED_TIMEOUT_SECONDS = 20;
var _deferredWorkData = {};
// Work scheduled for some point in the future
var _deferredWorkQueue = [];
// Work we need to process before the next redraw
var _beforeRedrawQueue = [];
// Counter to assign work ids
var _deferredWorkSequence = 0;
var _deferredTimeoutId = 0;

function _runDeferredWork(workId) {
    if (!_deferredWorkData[workId])
        return;
    let index = _deferredWorkQueue.indexOf(workId);
    if (index < 0)
        return;

    _deferredWorkQueue.splice(index, 1);
    _deferredWorkData[workId].callback();
    if (_deferredWorkQueue.length == 0 && _deferredTimeoutId > 0) {
        Mainloop.source_remove(_deferredTimeoutId);
        _deferredTimeoutId = 0;
    }
}

function _runAllDeferredWork() {
    while (_deferredWorkQueue.length > 0)
        _runDeferredWork(_deferredWorkQueue[0]);
}

function _runBeforeRedrawQueue() {
    for (let i = 0; i < _beforeRedrawQueue.length; i++) {
        let workId = _beforeRedrawQueue[i];
        _runDeferredWork(workId);
    }
    _beforeRedrawQueue = [];
}

function _queueBeforeRedraw(workId) {
    _beforeRedrawQueue.push(workId);
    if (_beforeRedrawQueue.length == 1) {
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, function () {
            _runBeforeRedrawQueue();
            return false;
        });
    }
}

/**
 * initializeDeferredWork:
 * @actor (Clutter.Actor): A #ClutterActor
 * @callback (function): Function to invoke to perform work
 *
 * This function sets up a callback to be invoked when either the
 * given actor is mapped, or after some period of time when the machine
 * is idle.  This is useful if your actor isn't always visible on the
 * screen (for example, all actors in the overview), and you don't want
 * to consume resources updating if the actor isn't actually going to be
 * displaying to the user.
 *
 * Note that queueDeferredWork is called by default immediately on
 * initialization as well, under the assumption that new actors
 * will need it.
 *
 * Returns (string): A string work identifer
 */
function initializeDeferredWork(actor, callback, props) {
    // Turn into a string so we can use as an object property
    let workId = '' + (++_deferredWorkSequence);
    _deferredWorkData[workId] = { 'actor': actor,
                                  'callback': callback };
    actor.connect('notify::mapped', function () {
        if (!(actor.mapped && _deferredWorkQueue.indexOf(workId) >= 0))
            return;
        _queueBeforeRedraw(workId);
    });
    actor.connect('destroy', function() {
        let index = _deferredWorkQueue.indexOf(workId);
        if (index >= 0)
            _deferredWorkQueue.splice(index, 1);
        delete _deferredWorkData[workId];
    });
    queueDeferredWork(workId);
    return workId;
}

/**
 * queueDeferredWork:
 * @workId (string): work identifier
 *
 * Ensure that the work identified by @workId will be
 * run on map or timeout.  You should call this function
 * for example when data being displayed by the actor has
 * changed.
 */
function queueDeferredWork(workId) {
    let data = _deferredWorkData[workId];
    if (!data) {
        global.logError('invalid work id: ' +  workId);
        return;
    }
    if (_deferredWorkQueue.indexOf(workId) < 0)
        _deferredWorkQueue.push(workId);
    if (data.actor.mapped) {
        _queueBeforeRedraw(workId);
        return;
    } else if (_deferredTimeoutId == 0) {
        _deferredTimeoutId = Mainloop.timeout_add_seconds(DEFERRED_TIMEOUT_SECONDS, function () {
            _runAllDeferredWork();
            _deferredTimeoutId = 0;
            return false;
        });
    }
}

/**
 * isInteresting:
 * @metaWindow (Meta.Window): the window to be tested
 *
 * Determines whether a window is "interesting", i.e.
 * ones to be displayed in alt-tab, window list etc.
 *
 * Returns (boolean): whether the window is interesting
 */
function isInteresting(metaWindow) {
    if (metaWindow.get_title() == "JavaEmbeddedFrame")
        return false;

    if (tracker.is_window_interesting(metaWindow)) {
        // The nominal case.
        return true;
    }
    // The rest of this function is devoted to discovering "orphan" windows
    // (dialogs without an associated app, e.g., the Logout dialog).
    if (tracker.get_window_app(metaWindow)) {
        // orphans don't have an app!
        return false;
    }    
    let type = metaWindow.get_window_type();
    return type === Meta.WindowType.DIALOG || type === Meta.WindowType.MODAL_DIALOG;
}

/**
 * getTabList:
 * @workspaceOpt (Meta.Workspace): (optional) workspace, defaults to global.screen.get_active_workspace()
 * @screenOpt (Meta.Screen): (optional) screen, defaults to global.screen
 *
 * Return a list of the interesting windows on a workspace (by default,
 * the active workspace).
 * The list will include app-less dialogs.
 *
 * Returns (array): list of windows
 */
function getTabList(workspaceOpt, screenOpt) {
    let screen = screenOpt || global.screen;
    let display = screen.get_display();
    let workspace = workspaceOpt || screen.get_active_workspace();

    let windows = []; // the array to return

    let allwindows = display.get_tab_list(Meta.TabList.NORMAL_ALL, screen,
                                       workspace);
    let registry = {}; // to avoid duplicates

    for (let i = 0; i < allwindows.length; ++i) {
        let window = allwindows[i];
        if (isInteresting(window)) {
            let seqno = window.get_stable_sequence();
            if (!registry[seqno]) {
                windows.push(window);
                registry[seqno] = true; // there may be duplicates in the list (rare)
            }
        }
    }
    return windows;
}
