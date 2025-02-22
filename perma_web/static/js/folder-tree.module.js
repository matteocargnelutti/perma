require('jstree');  // add jquery support for .tree
require('core-js/features/array/find');
require('jstree-css/default/style.min.css');

let APIModule = require('./helpers/api.module.js');
let Helpers = require('./helpers/general.helpers.js');
let DOMHelpers = require('./helpers/dom.helpers.js');

let localStorageKey = Helpers.variables.localStorageKey;
let allowedEventsCount = 0;
let lastSelectedFolder = null;
let hoveredNode = null;  // track currently hovered node in jsTree
export var folderTree = null;

export function init () {
  domTreeInit();
  setupEventHandlers();
  folderTree.deselect_all();
}

// When a user selects a folder, we store that choice in Local Storage
// and attempt to reselect on subsequent page loads.
export var ls = {
  // This data structure was built such that multiple users' last-used folders could be
  // stored simultaneously. At present, this feature is not in use: when a user logs out,
  // local storage is cleared. getAll remains in the codebase, with getCurrent, in case we ever
  // decide to change that behavior (not recommended at present due to the complications it may
  // introduce to user support: we don't want to have to walk people through clearing local
  // storage if unexpected behavior surfaces)
  getAll: function () {
    let folders = Helpers.jsonLocalStorage.getItem(localStorageKey);
    return folders || {};
  },
  getCurrent: function () {
    let folders = ls.getAll();
    return folders[current_user.id] || {};
  },
  setCurrent: function (orgId, folderIds) {
    let selectedFolders = ls.getAll();
    selectedFolders[current_user.id] = {'folderIds': folderIds, 'orgId': orgId};

    if (folderIds && folderIds.length){
      history.pushState(null, null, "?folder=" + folderIds.join('-'));
    }

    Helpers.jsonLocalStorage.setItem(localStorageKey, selectedFolders);
  }
};

export function folderListFromUrl() {
  let queryDict = Helpers.getQueryStringDict();
  if (queryDict['folder']){
    try {
      let folder_list = queryDict['folder'].split('-');
      folder_list = folder_list.map(s => parseInt(s));
      folder_list.forEach(i => {if(isNaN(i)) throw "Invalid folder list"});
      return folder_list
    } catch (err) {
      console.error(err);
    }
    return [];
  }
}

export function getSavedFolders(){
  // Look up the ID of the previously selected folder (if any)
  // looking first at the url, and then at localStorage.
  return folderListFromUrl() || ls.getCurrent().folderIds
}


export function getSavedFolder(){
  // Look up the ID of the previously selected folder (if any)
  let folderIds = getSavedFolders()
  if(folderIds && folderIds.length){
    return folderIds[folderIds.length - 1];
  }
  return null;
}

export function getSavedOrg(){
  // Look up the ID of the previously selected folder's org (if any) from localStorage.
  return ls.getCurrent().orgId;
}

export function getPathForId(folderId){
  let node = getNodeByFolderID(folderId);
  let path = folderTree.get_path(node);
  return path;
}

function getSelectedNode () {
  return folderTree.get_selected(true)[0];
}

function getSelectedFolderID () {
  return getSelectedNode().data.folder_id;
}

function getNodeByFolderID (folderId) {
  let folderData = folderTree._model.data;
  for(let i in folderData) {
    if(folderData.hasOwnProperty(i) &&
       folderData[i].data &&
       folderData[i].data.folder_id === folderId) {
        return folderTree.get_node(i);
    }
  }
  return null;
}

function handleSelectionChange (e, data) {
  let folderList;
  if (Array.isArray(data.folderId)) {
    folderList = data.folderId.map(x => parseInt(x));
  } else {
    folderList = [parseInt(data.folderId)]
  }
  ls.setCurrent(parseInt(data.orgId),folderList);
  folderTree.close_all();
  folderTree.deselect_all();
  selectSavedFolder();
}

function selectSavedFolder(){
  let folderToSelect = getSavedFolder();
  //select default for users with no orgs and no saved selections
  if(!folderToSelect && current_user.top_level_folders.length == 1){
    folderToSelect = current_user.top_level_folders[0].id;
  }
  if(folderToSelect){
    let node = getNodeByFolderID(folderToSelect);
    if (!node){
      folderTree.refresh(false, function(state){
        // This empty function let's the node get selected after the refresh,
        // necessary when selecting a Sponsored Folder from the dropdown, if
        // a Sponsored Folder has not previously been loaded.
        //
        // I don't understand why this works, and suspect it's brittle.
        // https://www.jstree.com/api/#/?q=(&f=refresh()
      });
      node = getNodeByFolderID(folderToSelect);
      node.state.selected = true;
    }
    if (node){
      folderTree.select_node(node);
    }
  }
}

function setSavedFolder (node) {
  let data = node.data;
  if (data) {
    let folderIds = folderTree.get_path(node, false, true).map(function(id){
      return folderTree.get_node(id).data.folder_id;
    });
    ls.setCurrent(data.organization_id, folderIds);
  }
  sendSelectionChangeEvent(node);
}

function sendSelectionChangeEvent (node) {
  let data = {};
  if (node.data) {
    data.folderId = node.data.folder_id;
    data.orgId = node.data.organization_id;
    data.sponsorId = node.data.sponsor_id;
    data.readOnly = node.data.read_only;
    data.path = folderTree.get_path(node);
  }
  Helpers.triggerOnWindow("FolderTreeModule.selectionChange", JSON.stringify(data));
}

function handleShowFoldersEvent(currentFolder, callback){
  // This function gets called by jsTree with the current folder, and a callback to return subfolders.
  // We either fetch subfolders from the API, or if currentFolder.data is empty, show the root folders.
  let simpleCallback = (callbackData) => callback.call(folderTree, callbackData);

  if(currentFolder.data){
    loadSingleFolder(currentFolder.data.folder_id, simpleCallback);
  } else {
    loadInitialFolders(
      apiFoldersToJsTreeFolders(current_user.top_level_folders),
      getSavedFolders(),
      simpleCallback);
  }
}

function apiFoldersToJsTreeFolders(apiFolders){
  // Helper to process a list of folders from our API into the form expected by jsTree.
  return apiFolders.map(function(folder){
    let jsTreeFolder = {
      text: folder.name,
      data: {
        folder_id: folder.id,
        organization_id: folder.organization,
        sponsor_id: folder.sponsored_by,
        is_sponsored_root_folder: folder.is_sponsored_root_folder,
        read_only: folder.read_only
      },
      "state": {"disabled": folder.is_sponsored_root_folder},
      "li_attr": {
        "data-folder_id": folder.id,
        "data-organization_id": folder.organization,
        "data-sponsor_id": folder.sponsored_by,
        "data-is_sponsored_root_folder": folder.is_sponsored_root_folder,
        "data-read_only": folder.read_only
      },
      "children": folder.has_children
    };
    if(folder.organization && !folder.parent){
      jsTreeFolder.type = "shared_folder";
    }
    return jsTreeFolder;
  });
}

function loadSingleFolder(folderId, callback){
  // Grab a single folder ID from the server and pass back to jsTree.
  // Temporarily limit response to 500; TODO: handle pagination
  APIModule.request("GET", `/folders/${folderId}/folders/?limit=500`).done(function(data){
    callback(apiFoldersToJsTreeFolders(data.objects));
  });
}

function loadInitialFolders(preloadedData, subfoldersToPreload, callback){
  // This runs once at startup. Starting from the list of the user's root folders, fetch any
  // subfolders in the tree that the user previously had open, and load the entire tree into jsTree at the end.

  // simple case -- user has no folders selected
  if(!subfoldersToPreload){
    callback(preloadedData);
    return;
  }
  // User does have folders selected. First, have jquery fetch contents of all folders in the selected path.
  // Set requestArgs["error"] to null to prevent a 404 from propagating up to the user.)
  // Temporarily limit response to 500; TODO: handle pagination
  $.when.apply($, subfoldersToPreload.map(folderId => APIModule.request("GET", `/folders/${folderId}/folders/?limit=500`, null, {"error": null})))

  // When all API requests have returned, loop through the responses and build the folder tree:
  .done(function(){
    let apiResponses = arguments;
    let parentFolders = preloadedData;

    // for each folder in the path ...
    for(let i=0; i<subfoldersToPreload.length; i++){

      // find the parent folder to load subfolders into, and mark it opened:
      let folderId = subfoldersToPreload[i];
      let parentFolder = parentFolders.find(folder => folderId == folder.data.folder_id);
      if(!parentFolder)
        // tree must have changed since last time user visited
        break;
      if(!parentFolder.state){
        parentFolder.state = {}
      }
      parentFolder.state.opened = true;

      // find the subfolders and load them in:
      let apiResponse = apiResponses[i][0];
      let subfolders = apiResponse ? apiResponse.objects : null;  // if API response doesn't make sense, we'll just stop loading the tree here
      if(subfolders && subfolders.length){
        parentFolder.children = apiFoldersToJsTreeFolders(subfolders);

        // set the loaded subfolders as the target for the next pass through this loop
        parentFolders = parentFolder.children;

      // if no subfolders, we're done
      }else{
        break;
      }
    }

    // pass our folder tree to jsTree for display
    callback(preloadedData);
  })

  // If fetching saved folders threw any API errors, something is wrong with the saved folder path (like maybe another user
  // moved the target folder) -- wipe the path and show top-level folders only.
  .fail(function(){
    localStorage.clear();
    callback(preloadedData);
  });
}

function domTreeInit () {
  $('#folder-tree')
    .jstree({
      core: {
        strings: {
          'New node': 'New Folder'
        },

        'data' : handleShowFoldersEvent,

        check_callback: function (operation, node, node_parent, node_position, more) {
          // Don't intercept the "edit" action: it just replaces the node with an input field for renaming
          if (operation == 'edit') {
            return true;
          }

          // Here we handle all actions on folders that have to be checked with the server.
          // That means we have to intercept the jsTree event, cancel it,
          // submit a request to the server, and in the success handler for that request
          // re-trigger the event so jsTree's UI will update.

          // Since we can't tell in this event handler whether an event was triggered by the user
          // (step 1) or by us (step 2), we increment allowedEventsCount when triggering
          // an event and decrement when the event is received:
          if (allowedEventsCount) {
            allowedEventsCount--;
            return true;
          }

          let targetNode = hoveredNode;

          if (more && more.is_foreign) {
            // link dragged onto folder
            if (operation == 'copy_node') {
              moveLink(targetNode.data.folder_id, node.id);
            }
          } else {
            // internal folder action
            if (operation == 'rename_node') {
              let newName = node_position;
              renameFolder(node.data.folder_id, newName)
                .done(function () {
                  allowedEventsCount++;
                  folderTree.rename_node(node, newName);
                  sendSelectionChangeEvent(node);
                });
            } else if (operation == 'move_node') {
              moveFolder(targetNode.data.folder_id, node.data.folder_id).done(function () {
                allowedEventsCount++;
                folderTree.move_node(node, targetNode);
              });
            } else if (operation == 'delete_node') {
              deleteFolder(node.data.folder_id).done(function () {
                allowedEventsCount++;
                folderTree.delete_node(node);
                folderTree.select_node(node.parent);
              });
            } else if (operation == 'create_node') {
              let newName = node.text;
              createFolder(node_parent.data.folder_id, newName).done(function (server_response) {
                allowedEventsCount++;
                folderTree.create_node(node_parent, node, "last", function (new_folder_node) {
                  new_folder_node.data = { folder_id: server_response.id, organization_id: node_parent.data.organization_id };
                  editNodeName(new_folder_node);
                });
              });
            }
          }
          return false; // cancel first instance of event while we check with server
        },

        error: (errorInfo) => {
          if(errorInfo.reason.substr(0, 11) != "User config" // "User config" means we canceled the operation ourself while we talk to the server
            && errorInfo.reason != "Moving parent inside child"){  // error is self-explanatory
            Helpers.informUser(errorInfo.reason);
          }
        },

        multiple: true
      },
      plugins: ['contextmenu', 'dnd', 'unique', 'types'],
      dnd: {
        check_while_dragging: false,
        drag_target: '.item-row',
        drag_finish: function (data) {},
        // Disable opening of closed folders on drag-n-drop hover -- hover-opening causes problems because moving a folder finishes
        // on the server before starting on the client, resulting in a moved folder colliding with itself.
        open_timeout: 0,
      },
      types: {
        "default": { // requires quotes because reserved word in IE8
          icon: "icon-folder-close-alt"
        },
        shared_folder: {
          icon: "icon-sitemap"
        }
      }
    // handle single clicks on folders -- show contents
    }).on("select_node.jstree", function (e, data) {
      if (data.selected.length == 1) {
        // showFolderContents(data.node.data.folder_id);

        // The intuitive interaction seems to be, any time you click on a closed folder we toggle it open,
        // but we only toggle to closed if you click again on the folder that was already selected.
        if(!data.node.state.opened || data.node==lastSelectedFolder)
          data.instance.toggle_node(data.node);
      }
      let lastSelectedNode = data.node;
      setSavedFolder(lastSelectedNode);

    // handle open/close folder icon
    }).on('after_open.jstree', function (e, data) {
      DOMHelpers.scrollIfTallerThanFractionOfViewport(".col-folders", 0.9);
      if(data.node.type=="default")
        data.instance.set_icon(data.node, "icon-folder-open-alt");

    }).on('after_close.jstree', function (e, data) {
      DOMHelpers.scrollIfTallerThanFractionOfViewport(".col-folders", 0.9);
      if(data.node.type=="default")
        data.instance.set_icon(data.node, "icon-folder-close-alt");

    }).on('load_node.jstree', function (e, data) {
      // when a new node is loaded, see if it should be selected based on a user's previous visit.
      // (without this, doesn't select saved folders on load.)
      selectSavedFolder();

    }).on('ready.jstree', function (e, data) {
      Helpers.triggerOnWindow("folderTree.ready");
    })

    // track currently hovered node in the hoveredNode variable:
    .on('hover_node.jstree', (e, data) => hoveredNode = data.node)
    .on('dehover_node.jstree', (e, data) => hoveredNode = null);

  folderTree = $.jstree.reference('#folder-tree');
}

function createFolder (parentFolderID, newName) {
  return APIModule.request("POST", "/folders/" + parentFolderID + "/folders/", {name: newName});
}

function renameFolder (folderID, newName) {
  return APIModule.request("PATCH", "/folders/" + folderID + "/", {name: newName});
}

function moveFolder (parentID, childID) {
  return APIModule.request("PUT", "/folders/" + parentID + "/folders/" + childID + "/");
}

function deleteFolder (folderID) {
  return APIModule.request("DELETE", "/folders/" + folderID + "/");
}

function moveLink (folderID, linkID) {
  return APIModule.request("PUT", "/folders/" + folderID + "/archives/" + linkID + "/").done(function(data){
    $(window).trigger("FolderTreeModule.updateLinksRemaining", data.links_remaining);
    // once we're done moving the link, hide it from the current folder
    $('.item-row[data-link_id="'+linkID+'"]').closest('.item-container').remove();
  });
}

function setupEventHandlers () {
  $(window)
    .on('dropdown.selectionChange', function(e, data){
      handleSelectionChange(e, data);
    })
    .on('batchLink.reloadTreeForFolder', function(e, data) {
      handleSelectionChange(e, data);
      folderTree.destroy();
      domTreeInit();
    })
    .on('LinksListModule.moveLink', function(evt, data) {
      data = JSON.parse(data);
      moveLink(data.folderId, data.linkId);
    });

  // scroll helper
  DOMHelpers.markIfScrolled('.col-folders');

  // set body class during drag'n'drop
  $(document).on('dnd_start.vakata', function (e, data) {
    $('body').addClass("dragging");

  }).on('dnd_stop.vakata', function (e, data) {
    $('body').removeClass("dragging");
  });

  // folder buttons
  $('a.new-folder').on('click', function () {
    folderTree.create_node(getSelectedNode(), {}, "last");
    return false;
  });
  $('a.edit-folder').on('click', function () {
    editNodeName(getSelectedNode());
    return false;
  });
  $('a.delete-folder').on('click', function () {
    var node = getSelectedNode();
    if (!confirm("Really delete folder '" + node.text.trim() + "'?")) return false;
    folderTree.delete_node(node);
    return false;
  });

  // special handling for Sponsored Links parent folder
  $('#folder-tree').on('click', 'li[data-is_sponsored_root_folder="true"] > a', function (e) {
    let node = getNodeByFolderID(Number(e.target.parentNode.dataset.folder_id));
    folderTree.toggle_node(node);
  });
}

function editNodeName (node) {
  setTimeout(function () {
    folderTree.edit(node);
  }, 0);
}
