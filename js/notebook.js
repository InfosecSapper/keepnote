// Import libs.
if (typeof require !== 'undefined') {
    var icons = require('./icons.js');
}


// Notebook node model.
var Node = Backbone.Model.extend({

    PAGE_CONTENT_TYPE: 'text/xhtml+xml',
    PAGE_FILE: 'page.html',

    initialize: function () {
        this.notebook = null;
        this.parents = [];
        this.children = [];
        this.files = {};
        this.file = this.getFile('');
        this.ordered = false;
        this.fetched = false;

        this.on('change', this.onChange, this);
        this.on('change:childrenids', this.onChangeChildren, this);
        this.on('change:parentids', this.onChangeParents, this);
    },

    // TODO: make customizable.
    urlRoot: '/notebook/nodes/',
    idAttribute: 'nodeid',

    // Fetch node data.
    fetch: function (options) {
        var result = Node.__super__.fetch.call(this, options);
        return result.done(function () {
            this.fetched = true;

            this.onChangeChildren();
            this.onChangeParents();
        }.bind(this));
    },

    // Fetch node data only if not already fetched.
    ensureFetched: function () {
        var defer = $.Deferred();
        if (!this.fetched)
            defer = this.fetch();
        else
            defer.resolve();
        return defer;
    },

    onChange: function () {
    },

    // Allocate children nodes.
    onChangeChildren: function () {
        // Allocate and register new children.
        var childrenIds = this.get('childrenids') || [];
        var hasOrderLoaded = true;
        this.children = [];
        for (var i=0; i<childrenIds.length; i++) {
            var child = this.notebook.getNode(childrenIds[i]);
            this.children.push(child);
            if (typeof child.get('order') === 'undefined') {
                hasOrderLoaded = false;
            }
        }

        // Sort children by their order.
        if (hasOrderLoaded)
            this.orderChildren(false);
    },

    // Allocate parent nodes.
    onChangeParents: function () {
        // Allocate and register new children.
        var parentIds = this.get('parentids') || [];
        this.parents = [];
        for (var i=0; i<parentIds.length; i++) {
            this.parents.push(this.notebook.getNode(parentIds[i]));
        }
    },

    _loadChildren: function () {
        var defers = [];

        for (var i=0; i<this.children.length; i++)
            defers.push(this.children[i].fetch());

        return $.when.apply($, defers);
    },

    // Fetch all children.
    fetchChildren: function (refetch) {
        var defer = $.Deferred();
        if (!this.fetched || refetch)
            defer = this.fetch();
        else
            defer.resolve();
        return defer
            .then(this._loadChildren.bind(this))
            .then(this.orderChildren.bind(this));
    },

    orderChildren: function (trigger) {
        if (typeof trigger === 'undefined')
            trigger = true;

        this.children.sort(function (node1, node2) {
            var val1 = (node1.get('order') || 0);
            var val2 = (node2.get('order') || 0);
            return val1 - val2;
        });

        // Update children ids.
        var childrenIds = [];
        for (var i=0; i<this.children.length; i++)
            childrenIds.push(this.children[i].id);
        this.set('childrenids', childrenIds);

        this.ordered = true;
        if (trigger)
            this.trigger('change');
    },

    // Recursively fetch all expanded nodes.
    fetchExpanded: function (expandAttr) {
        expandAttr = expandAttr || 'expanded';

        var defer = $.Deferred();

        // Fetch this node if needed.
        if (!this.fetched)
            defer = this.fetch();
        else
            defer.resolve();

        // Recursively fetch children.
        return defer.then(function () {
            if (this.get(expandAttr)) {
                var defers = [];
                for (var i=0; i<this.children.length; i++) {
                    defers.push(this.children[i].fetchExpanded());
                }

                // After all child load, order them.
                return $.when.apply($, defers).done(
                    this.orderChildren.bind(this)
                );
            }
        }.bind(this));
    },

    // Return true if this node is a descendent of ancestor.
    isDescendant: function(ancestor) {
        var ptr = this;
        while (true) {
            if (ptr === ancestor)
                return true;
            if (ptr.parents.length > 0)
                ptr = ptr.parents[0];
            else
                break;
        }
        return false;
    },

    isPage: function () {
        return this.get('content_type') === this.PAGE_CONTENT_TYPE;
    },

    fileUrl: function (filename) {
        return this.url() + '/' + filename;
    },

    pageUrl: function () {
        return this.fileUrl(this.PAGE_FILE);
    },

    payloadUrl: function () {
        return this.fileUrl(this.get('payload_filename'));
    },

    getFile: function (filename) {
        if (filename in this.files)
            return this.files[filename];

        var file = new NodeFile({
            node: this,
            path: filename
        });

        this.files[filename] = file;
        this.registerFile(file);

        return file;
    },

    registerFile: function (file) {
        file.on('change', function () {
            this.trigger('file-change');
        }, this);
        file.on('destroy', function () {
            this.onFileDestroy(file); }, this);
    },

    unregisterFile: function (file) {
        file.off('change', null, this);
        file.off('destroy', function () {
            this.onFileDestroy(file); }, this);
    },

    onFileDestroy: function (file) {
        this.unregisterFile(file);
    },

    _isDir: function (filename) {
        return filename.match(/\/$/);
    },

    writeFile: function (filename, content) {
        if (this._isDir(filename))
            throw 'Cannot write to a directory.';
        return $.post(this.fileUrl(filename), content);
    },

    readFile: function (filename) {
        if (this._isDir(filename))
            throw 'Cannot read from a directory.';
        return $.get(this.fileUrl(filename));
    },

    deleteFile: function (filename) {
        var file = this.getFile(filename);
        return file.destroy();
    },

    hasFile: function (filename) {
        var defer = $.Deferred();
        $.ajax({
            type: 'HEAD',
            url: this.fileUrl(filename)
        }).done(function () {
            defer.resolve(true);
        }).fail(function () {
            defer.resolve(false);
        });
        return defer;
    },

    move: function (options) {
        return this.notebook.moveNode(this, options);
    }
});


// Notebook node file model.
var NodeFile = Backbone.Model.extend({

    initialize: function (options) {
        this.node = options.node;
        this.path = options.path || '';
        this.children = [];

        this.isDir = (this.path === '' ||
                      this.path.substr(-1) === '/');
    },

    url: function () {
        var parts = this.path.split('/');
        for (var i in parts)
            parts[i] = encodeURIComponent(parts[i]);
        return this.node.url() + '/' + parts.join('/');
    },

    basename: function () {
        if (this.path === '')
            return '';

        var parts = this.path.split('/');
        if (this.isDir)
            return parts[parts.length - 2];
        else
            return parts[parts.length - 1];
    },

    _allocateChildren: function (files) {
        this.trigger('removing-children', this);

        // Allocate and register new children.
        this.children = [];
        for (var i=0; i<files.length; i++)
            this.children.push(this.node.getFile(files[i]));

        this.trigger('adding-children', this);
    },

    fetch: function (options) {
        // Files do not have any meta data and nothing to fetch.
        if (!this.isDir)
            return $.Deferred().resolve();

        var result = Node.__super__.fetch.call(this, options);
        return result.done(function () {
            // Allocate children nodes.
            var files = this.get('files');
            this._allocateChildren(files);

            this.trigger('change');
        }.bind(this));
    },

    fetchChildren: function () {
        return this.fetch().then(function () {
            return this.children;
        }.bind(this));
    },

    getChildByName: function (name) {
        for (var i=0; i<this.children.length; i++) {
            var child = this.children[i];
            if (child.basename() === name)
                return child;
        }
        return null;
    },

    read: function () {
        if (!this.isDir)
            return $.get(this.url());
        else
            throw 'Cannot read from a directory';
    },

    write: function (data) {
        if (!this.isDir)
            return $.post(this.url(), data);
        else
            throw 'Cannot write to a directory';
    }
});


var NoteBook = Backbone.Model.extend({

    NOTEBOOK_META_DIR: '__NOTEBOOK__',
    NOTEBOOK_ICON_DIR: 'icons',

    urlRoot: '/notebook/',

    initialize: function (options) {
        this.nodes = {};
        this.root = this.getNode(options.rootid);
    },

    fetch: function (options) {
        return this.root.fetch();
    },

    save: function () {
        return $.ajax({
            type: 'POST',
            url: this.urlRoot + '?save'
        });
    },

    search: function (query) {
        return $.ajax({
            type: 'POST',
            url: this.urlRoot + '?index',
            data: JSON.stringify(query),
            dataType: 'json'
        });
    },

    searchTitle: function (title) {
        return this.search(['search', 'title', title]);
    },

    // Return a node in the node cache.
    getNode: function (nodeid) {
        if (nodeid in this.nodes)
            return this.nodes[nodeid];

        var node = new Node({nodeid: nodeid});
        node.notebook = this;
        this.registerNode(node);

        return node;
    },

    fetchNode: function (nodeid) {
        var node = this.getNode(nodeid);
        return node.fetch();
    },

    // Register all callbacks for a node.
    registerNode: function (node) {
        this.nodes[node.id] = node;

        // Node listeners.
        node.on('change', function () {
            this.onNodeChange(node); }, this);
        node.on('destroy', function () {
            this.onNodeDestroy(node); }, this);
        node.on('file-change', function (file) {
            this.onFileChange(file); }, this);
    },

    // Unregister all callbacks for a node.
    unregisterNode: function (node) {
        node.off('change', null, this);
        node.off('destroy', null, this);
        delete this.nodes[node.id];
    },

    // Callback for when nodes change.
    onNodeChange: function (node) {
        this.trigger('node-change', this, node);
        this.trigger('change');
    },

    onNodeDestroy: function (node) {
        // TODO: don't rely on store to update children ids.
        // Refetch all parents.
        for (var i=0; i<node.parents.length; i++) {
            node.parents[i].fetch();
        }

        // TODO: decide what to do with children. Recurse?

        this.unregisterNode(node);
        this.trigger('change');
    },

    // Callback for when files change.
    onFileChange: function (file) {
        this.trigger('file-change', this, file);
        this.trigger('change');
    },

    newNode: function (parent, index) {
        var NEW_TITLE = 'New Page';
        var EMPTY_PAGE = '<html><body></body></html>';

        if (index === null || typeof index === 'undefined')
            index = parent.children.length;
        if (index > parent.children.length)
            index = parent.children.length;

        // Create new node.
        var childrenIds;
        var node = new Node({
            'content_type': this.root.PAGE_CONTENT_TYPE,
            'title': NEW_TITLE,
            'parentids': [parent.id],
            'childrenids': [],
            'order': index
        });
        node.notebook = this;
        return node.save().then(function (result) {
            node.id = result.nodeid;
            this.registerNode(node);

            // Create empty page.
            var file = node.getFile(node.PAGE_FILE);
            file.write(EMPTY_PAGE);

            // Adjust parent children ids.
            childrenIds = parent.get('childrenids').slice(0);
            childrenIds.splice(index, 0, node.id);

            // Update all children orders.
            return this.updateChildOrder(childrenIds);
        }.bind(this)).then(function () {
            return parent.save(
                {childrenids: childrenIds},
                {wait: true}
            ).then(function () {
                return parent.fetchChildren(true);
            }).then(function () {
                return node;
            });
        }.bind(this));
    },

    deleteNode: function (node) {
        return node.destroy();
    },

    moveNode: function(node, options) {
        var target = options.target;
        var relation = options.relation;
        var parent = options.parent;
        var index = options.index;

        // Determine parent and index.
        if (typeof parent !== 'undefined') {
            // Parent is given, determine index.
            if (index === null || typeof index === 'undefined')
                index = parent.children.length;
            if (index > parent.children.length)
                index = parent.children.length;

        } else if (typeof target === 'undefined') {
            // Without parent, target must be given.
            throw 'Target node must be given';

        } else if (relation === 'child') {
            // Move node to be the last child of target.
            parent = target;
            index = parent.children.length;

        } else if (relation === 'after' || relation === 'before') {
            // Move node to be sibling of target.
            parent = target;
            if (parent.parents.length > 0)
                parent = parent.parents[0];
            index = parent.children.indexOf(target);
            if (index === -1)
                index = parent.children.length;
            else if (relation === 'after')
                index++;

        } else {
            throw 'Unknown relation: ' + relation;
        }

        // Remove node from old location, use place holder null.
        var oldParent = node.parents[0];
        var oldChildrenIds = oldParent.get('childrenids').slice(0);
        var i = oldChildrenIds.indexOf(node.id);
        oldChildrenIds[i] = null;

        // Insert child into new parent.
        var childrenIds;
        if (parent === oldParent)
            childrenIds = oldChildrenIds;
        else
            childrenIds = parent.get('childrenids').slice(0);
        childrenIds.splice(index, 0, node.id);

        // Remove placeholder null.
        i = oldChildrenIds.indexOf(null);
        oldChildrenIds.splice(i, 1);

        // Save child.
        node.set({
            parentids: [parent.id]
        });
        return node.save().then(function () {
            // Update all sibling orders of new parent.
            // We can leave old parent's orders non-contiguous.
            return this.updateChildOrder(childrenIds);

        }.bind(this)).then(function () {
            // Save new parent children.
            var defer = parent.save(
                {childrenids: childrenIds},
                {wait: true}
            ).then(function () {
                return parent.fetchChildren(true);
            });

            // Save old parent children, if distinct.
            var defer2 = $.Deferred();
            if (parent !== oldParent) {
                defer2 = oldParent.save(
                    {childrenids: oldChildrenIds},
                    {wait: true}
                ).then(function () {
                    return oldParent.fetchChildren(true);
                });
            } else {
                defer2.resolve();
            }

            return $.when(defer, defer2);
        }.bind(this));
    },

    // Update the order attr for all children given by their sorting.
    updateChildOrder: function (childrenIds) {
        var defers = [];

        for (var i=0; i<childrenIds.length; i++) {
            var child = this.getNode(childrenIds[i]);
            if (typeof child === 'undefined')
                continue;

            defers.push(child.save({order: i}));
        }

        return $.when.apply($, defers);
    },

    getIconFilename: function (basename) {
        return this.NOTEBOOK_META_DIR + '/' + this.NOTEBOOK_ICON_DIR + '/' +
            basename;
    },

    basenames2filenames: {
        'note.png': '/static/images/node_icons/note.png',
        'note-unknown.png': '/static/images/node_icons/note-unknown.png'
    },

    getNodeIcon: function (node, kind) {
        var basenames = icons.getNodeIconBasenames(node)[kind];

        var registerFilename = function (basename, filename) {
            this.basenames2filenames[basename] = filename;
            this.trigger('changed');
        };

        for (var i=0; i<basenames.length; i++) {
            var basename = basenames[i];
            if (!(basename in this.basenames2filenames)) {
                this.basenames2filenames[basename] = null;

                // Attempt to load filename for basename.
                icons.lookupIconFilename(this, basename).done(
                    registerFilename.bind(this, basename)
                );

                // Temp filename while real one loads.
                return this.basenames2filenames['note.png'];
            } else {
                var filename = this.basenames2filenames[basename];
                if (filename)
                    return filename;
            }
        }

        return '/static/images/node_icons/note-unknown.png';
    }
});


if (typeof module !== 'undefined') {
    module.exports.NoteBook = NoteBook;
}
