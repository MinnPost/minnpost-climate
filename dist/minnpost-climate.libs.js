
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.9 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.9',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define("requirejs", function(){});

/**
 * @license RequireJS text 2.0.10 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.10',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.indexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1, name.length);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file.indexOf('\uFEFF') === 0) {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                errback(e);
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        errback(err);
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes,
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});

/*! jQuery v1.9.1 | (c) 2005, 2012 jQuery Foundation, Inc. | jquery.org/license
//@ sourceMappingURL=jquery.min.map
*/(function(e,t){var n,r,i=typeof t,o=e.document,a=e.location,s=e.jQuery,u=e.$,l={},c=[],p="1.9.1",f=c.concat,d=c.push,h=c.slice,g=c.indexOf,m=l.toString,y=l.hasOwnProperty,v=p.trim,b=function(e,t){return new b.fn.init(e,t,r)},x=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,w=/\S+/g,T=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,N=/^(?:(<[\w\W]+>)[^>]*|#([\w-]*))$/,C=/^<(\w+)\s*\/?>(?:<\/\1>|)$/,k=/^[\],:{}\s]*$/,E=/(?:^|:|,)(?:\s*\[)+/g,S=/\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,A=/"[^"\\\r\n]*"|true|false|null|-?(?:\d+\.|)\d+(?:[eE][+-]?\d+|)/g,j=/^-ms-/,D=/-([\da-z])/gi,L=function(e,t){return t.toUpperCase()},H=function(e){(o.addEventListener||"load"===e.type||"complete"===o.readyState)&&(q(),b.ready())},q=function(){o.addEventListener?(o.removeEventListener("DOMContentLoaded",H,!1),e.removeEventListener("load",H,!1)):(o.detachEvent("onreadystatechange",H),e.detachEvent("onload",H))};b.fn=b.prototype={jquery:p,constructor:b,init:function(e,n,r){var i,a;if(!e)return this;if("string"==typeof e){if(i="<"===e.charAt(0)&&">"===e.charAt(e.length-1)&&e.length>=3?[null,e,null]:N.exec(e),!i||!i[1]&&n)return!n||n.jquery?(n||r).find(e):this.constructor(n).find(e);if(i[1]){if(n=n instanceof b?n[0]:n,b.merge(this,b.parseHTML(i[1],n&&n.nodeType?n.ownerDocument||n:o,!0)),C.test(i[1])&&b.isPlainObject(n))for(i in n)b.isFunction(this[i])?this[i](n[i]):this.attr(i,n[i]);return this}if(a=o.getElementById(i[2]),a&&a.parentNode){if(a.id!==i[2])return r.find(e);this.length=1,this[0]=a}return this.context=o,this.selector=e,this}return e.nodeType?(this.context=this[0]=e,this.length=1,this):b.isFunction(e)?r.ready(e):(e.selector!==t&&(this.selector=e.selector,this.context=e.context),b.makeArray(e,this))},selector:"",length:0,size:function(){return this.length},toArray:function(){return h.call(this)},get:function(e){return null==e?this.toArray():0>e?this[this.length+e]:this[e]},pushStack:function(e){var t=b.merge(this.constructor(),e);return t.prevObject=this,t.context=this.context,t},each:function(e,t){return b.each(this,e,t)},ready:function(e){return b.ready.promise().done(e),this},slice:function(){return this.pushStack(h.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},eq:function(e){var t=this.length,n=+e+(0>e?t:0);return this.pushStack(n>=0&&t>n?[this[n]]:[])},map:function(e){return this.pushStack(b.map(this,function(t,n){return e.call(t,n,t)}))},end:function(){return this.prevObject||this.constructor(null)},push:d,sort:[].sort,splice:[].splice},b.fn.init.prototype=b.fn,b.extend=b.fn.extend=function(){var e,n,r,i,o,a,s=arguments[0]||{},u=1,l=arguments.length,c=!1;for("boolean"==typeof s&&(c=s,s=arguments[1]||{},u=2),"object"==typeof s||b.isFunction(s)||(s={}),l===u&&(s=this,--u);l>u;u++)if(null!=(o=arguments[u]))for(i in o)e=s[i],r=o[i],s!==r&&(c&&r&&(b.isPlainObject(r)||(n=b.isArray(r)))?(n?(n=!1,a=e&&b.isArray(e)?e:[]):a=e&&b.isPlainObject(e)?e:{},s[i]=b.extend(c,a,r)):r!==t&&(s[i]=r));return s},b.extend({noConflict:function(t){return e.$===b&&(e.$=u),t&&e.jQuery===b&&(e.jQuery=s),b},isReady:!1,readyWait:1,holdReady:function(e){e?b.readyWait++:b.ready(!0)},ready:function(e){if(e===!0?!--b.readyWait:!b.isReady){if(!o.body)return setTimeout(b.ready);b.isReady=!0,e!==!0&&--b.readyWait>0||(n.resolveWith(o,[b]),b.fn.trigger&&b(o).trigger("ready").off("ready"))}},isFunction:function(e){return"function"===b.type(e)},isArray:Array.isArray||function(e){return"array"===b.type(e)},isWindow:function(e){return null!=e&&e==e.window},isNumeric:function(e){return!isNaN(parseFloat(e))&&isFinite(e)},type:function(e){return null==e?e+"":"object"==typeof e||"function"==typeof e?l[m.call(e)]||"object":typeof e},isPlainObject:function(e){if(!e||"object"!==b.type(e)||e.nodeType||b.isWindow(e))return!1;try{if(e.constructor&&!y.call(e,"constructor")&&!y.call(e.constructor.prototype,"isPrototypeOf"))return!1}catch(n){return!1}var r;for(r in e);return r===t||y.call(e,r)},isEmptyObject:function(e){var t;for(t in e)return!1;return!0},error:function(e){throw Error(e)},parseHTML:function(e,t,n){if(!e||"string"!=typeof e)return null;"boolean"==typeof t&&(n=t,t=!1),t=t||o;var r=C.exec(e),i=!n&&[];return r?[t.createElement(r[1])]:(r=b.buildFragment([e],t,i),i&&b(i).remove(),b.merge([],r.childNodes))},parseJSON:function(n){return e.JSON&&e.JSON.parse?e.JSON.parse(n):null===n?n:"string"==typeof n&&(n=b.trim(n),n&&k.test(n.replace(S,"@").replace(A,"]").replace(E,"")))?Function("return "+n)():(b.error("Invalid JSON: "+n),t)},parseXML:function(n){var r,i;if(!n||"string"!=typeof n)return null;try{e.DOMParser?(i=new DOMParser,r=i.parseFromString(n,"text/xml")):(r=new ActiveXObject("Microsoft.XMLDOM"),r.async="false",r.loadXML(n))}catch(o){r=t}return r&&r.documentElement&&!r.getElementsByTagName("parsererror").length||b.error("Invalid XML: "+n),r},noop:function(){},globalEval:function(t){t&&b.trim(t)&&(e.execScript||function(t){e.eval.call(e,t)})(t)},camelCase:function(e){return e.replace(j,"ms-").replace(D,L)},nodeName:function(e,t){return e.nodeName&&e.nodeName.toLowerCase()===t.toLowerCase()},each:function(e,t,n){var r,i=0,o=e.length,a=M(e);if(n){if(a){for(;o>i;i++)if(r=t.apply(e[i],n),r===!1)break}else for(i in e)if(r=t.apply(e[i],n),r===!1)break}else if(a){for(;o>i;i++)if(r=t.call(e[i],i,e[i]),r===!1)break}else for(i in e)if(r=t.call(e[i],i,e[i]),r===!1)break;return e},trim:v&&!v.call("\ufeff\u00a0")?function(e){return null==e?"":v.call(e)}:function(e){return null==e?"":(e+"").replace(T,"")},makeArray:function(e,t){var n=t||[];return null!=e&&(M(Object(e))?b.merge(n,"string"==typeof e?[e]:e):d.call(n,e)),n},inArray:function(e,t,n){var r;if(t){if(g)return g.call(t,e,n);for(r=t.length,n=n?0>n?Math.max(0,r+n):n:0;r>n;n++)if(n in t&&t[n]===e)return n}return-1},merge:function(e,n){var r=n.length,i=e.length,o=0;if("number"==typeof r)for(;r>o;o++)e[i++]=n[o];else while(n[o]!==t)e[i++]=n[o++];return e.length=i,e},grep:function(e,t,n){var r,i=[],o=0,a=e.length;for(n=!!n;a>o;o++)r=!!t(e[o],o),n!==r&&i.push(e[o]);return i},map:function(e,t,n){var r,i=0,o=e.length,a=M(e),s=[];if(a)for(;o>i;i++)r=t(e[i],i,n),null!=r&&(s[s.length]=r);else for(i in e)r=t(e[i],i,n),null!=r&&(s[s.length]=r);return f.apply([],s)},guid:1,proxy:function(e,n){var r,i,o;return"string"==typeof n&&(o=e[n],n=e,e=o),b.isFunction(e)?(r=h.call(arguments,2),i=function(){return e.apply(n||this,r.concat(h.call(arguments)))},i.guid=e.guid=e.guid||b.guid++,i):t},access:function(e,n,r,i,o,a,s){var u=0,l=e.length,c=null==r;if("object"===b.type(r)){o=!0;for(u in r)b.access(e,n,u,r[u],!0,a,s)}else if(i!==t&&(o=!0,b.isFunction(i)||(s=!0),c&&(s?(n.call(e,i),n=null):(c=n,n=function(e,t,n){return c.call(b(e),n)})),n))for(;l>u;u++)n(e[u],r,s?i:i.call(e[u],u,n(e[u],r)));return o?e:c?n.call(e):l?n(e[0],r):a},now:function(){return(new Date).getTime()}}),b.ready.promise=function(t){if(!n)if(n=b.Deferred(),"complete"===o.readyState)setTimeout(b.ready);else if(o.addEventListener)o.addEventListener("DOMContentLoaded",H,!1),e.addEventListener("load",H,!1);else{o.attachEvent("onreadystatechange",H),e.attachEvent("onload",H);var r=!1;try{r=null==e.frameElement&&o.documentElement}catch(i){}r&&r.doScroll&&function a(){if(!b.isReady){try{r.doScroll("left")}catch(e){return setTimeout(a,50)}q(),b.ready()}}()}return n.promise(t)},b.each("Boolean Number String Function Array Date RegExp Object Error".split(" "),function(e,t){l["[object "+t+"]"]=t.toLowerCase()});function M(e){var t=e.length,n=b.type(e);return b.isWindow(e)?!1:1===e.nodeType&&t?!0:"array"===n||"function"!==n&&(0===t||"number"==typeof t&&t>0&&t-1 in e)}r=b(o);var _={};function F(e){var t=_[e]={};return b.each(e.match(w)||[],function(e,n){t[n]=!0}),t}b.Callbacks=function(e){e="string"==typeof e?_[e]||F(e):b.extend({},e);var n,r,i,o,a,s,u=[],l=!e.once&&[],c=function(t){for(r=e.memory&&t,i=!0,a=s||0,s=0,o=u.length,n=!0;u&&o>a;a++)if(u[a].apply(t[0],t[1])===!1&&e.stopOnFalse){r=!1;break}n=!1,u&&(l?l.length&&c(l.shift()):r?u=[]:p.disable())},p={add:function(){if(u){var t=u.length;(function i(t){b.each(t,function(t,n){var r=b.type(n);"function"===r?e.unique&&p.has(n)||u.push(n):n&&n.length&&"string"!==r&&i(n)})})(arguments),n?o=u.length:r&&(s=t,c(r))}return this},remove:function(){return u&&b.each(arguments,function(e,t){var r;while((r=b.inArray(t,u,r))>-1)u.splice(r,1),n&&(o>=r&&o--,a>=r&&a--)}),this},has:function(e){return e?b.inArray(e,u)>-1:!(!u||!u.length)},empty:function(){return u=[],this},disable:function(){return u=l=r=t,this},disabled:function(){return!u},lock:function(){return l=t,r||p.disable(),this},locked:function(){return!l},fireWith:function(e,t){return t=t||[],t=[e,t.slice?t.slice():t],!u||i&&!l||(n?l.push(t):c(t)),this},fire:function(){return p.fireWith(this,arguments),this},fired:function(){return!!i}};return p},b.extend({Deferred:function(e){var t=[["resolve","done",b.Callbacks("once memory"),"resolved"],["reject","fail",b.Callbacks("once memory"),"rejected"],["notify","progress",b.Callbacks("memory")]],n="pending",r={state:function(){return n},always:function(){return i.done(arguments).fail(arguments),this},then:function(){var e=arguments;return b.Deferred(function(n){b.each(t,function(t,o){var a=o[0],s=b.isFunction(e[t])&&e[t];i[o[1]](function(){var e=s&&s.apply(this,arguments);e&&b.isFunction(e.promise)?e.promise().done(n.resolve).fail(n.reject).progress(n.notify):n[a+"With"](this===r?n.promise():this,s?[e]:arguments)})}),e=null}).promise()},promise:function(e){return null!=e?b.extend(e,r):r}},i={};return r.pipe=r.then,b.each(t,function(e,o){var a=o[2],s=o[3];r[o[1]]=a.add,s&&a.add(function(){n=s},t[1^e][2].disable,t[2][2].lock),i[o[0]]=function(){return i[o[0]+"With"](this===i?r:this,arguments),this},i[o[0]+"With"]=a.fireWith}),r.promise(i),e&&e.call(i,i),i},when:function(e){var t=0,n=h.call(arguments),r=n.length,i=1!==r||e&&b.isFunction(e.promise)?r:0,o=1===i?e:b.Deferred(),a=function(e,t,n){return function(r){t[e]=this,n[e]=arguments.length>1?h.call(arguments):r,n===s?o.notifyWith(t,n):--i||o.resolveWith(t,n)}},s,u,l;if(r>1)for(s=Array(r),u=Array(r),l=Array(r);r>t;t++)n[t]&&b.isFunction(n[t].promise)?n[t].promise().done(a(t,l,n)).fail(o.reject).progress(a(t,u,s)):--i;return i||o.resolveWith(l,n),o.promise()}}),b.support=function(){var t,n,r,a,s,u,l,c,p,f,d=o.createElement("div");if(d.setAttribute("className","t"),d.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",n=d.getElementsByTagName("*"),r=d.getElementsByTagName("a")[0],!n||!r||!n.length)return{};s=o.createElement("select"),l=s.appendChild(o.createElement("option")),a=d.getElementsByTagName("input")[0],r.style.cssText="top:1px;float:left;opacity:.5",t={getSetAttribute:"t"!==d.className,leadingWhitespace:3===d.firstChild.nodeType,tbody:!d.getElementsByTagName("tbody").length,htmlSerialize:!!d.getElementsByTagName("link").length,style:/top/.test(r.getAttribute("style")),hrefNormalized:"/a"===r.getAttribute("href"),opacity:/^0.5/.test(r.style.opacity),cssFloat:!!r.style.cssFloat,checkOn:!!a.value,optSelected:l.selected,enctype:!!o.createElement("form").enctype,html5Clone:"<:nav></:nav>"!==o.createElement("nav").cloneNode(!0).outerHTML,boxModel:"CSS1Compat"===o.compatMode,deleteExpando:!0,noCloneEvent:!0,inlineBlockNeedsLayout:!1,shrinkWrapBlocks:!1,reliableMarginRight:!0,boxSizingReliable:!0,pixelPosition:!1},a.checked=!0,t.noCloneChecked=a.cloneNode(!0).checked,s.disabled=!0,t.optDisabled=!l.disabled;try{delete d.test}catch(h){t.deleteExpando=!1}a=o.createElement("input"),a.setAttribute("value",""),t.input=""===a.getAttribute("value"),a.value="t",a.setAttribute("type","radio"),t.radioValue="t"===a.value,a.setAttribute("checked","t"),a.setAttribute("name","t"),u=o.createDocumentFragment(),u.appendChild(a),t.appendChecked=a.checked,t.checkClone=u.cloneNode(!0).cloneNode(!0).lastChild.checked,d.attachEvent&&(d.attachEvent("onclick",function(){t.noCloneEvent=!1}),d.cloneNode(!0).click());for(f in{submit:!0,change:!0,focusin:!0})d.setAttribute(c="on"+f,"t"),t[f+"Bubbles"]=c in e||d.attributes[c].expando===!1;return d.style.backgroundClip="content-box",d.cloneNode(!0).style.backgroundClip="",t.clearCloneStyle="content-box"===d.style.backgroundClip,b(function(){var n,r,a,s="padding:0;margin:0;border:0;display:block;box-sizing:content-box;-moz-box-sizing:content-box;-webkit-box-sizing:content-box;",u=o.getElementsByTagName("body")[0];u&&(n=o.createElement("div"),n.style.cssText="border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px",u.appendChild(n).appendChild(d),d.innerHTML="<table><tr><td></td><td>t</td></tr></table>",a=d.getElementsByTagName("td"),a[0].style.cssText="padding:0;margin:0;border:0;display:none",p=0===a[0].offsetHeight,a[0].style.display="",a[1].style.display="none",t.reliableHiddenOffsets=p&&0===a[0].offsetHeight,d.innerHTML="",d.style.cssText="box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;",t.boxSizing=4===d.offsetWidth,t.doesNotIncludeMarginInBodyOffset=1!==u.offsetTop,e.getComputedStyle&&(t.pixelPosition="1%"!==(e.getComputedStyle(d,null)||{}).top,t.boxSizingReliable="4px"===(e.getComputedStyle(d,null)||{width:"4px"}).width,r=d.appendChild(o.createElement("div")),r.style.cssText=d.style.cssText=s,r.style.marginRight=r.style.width="0",d.style.width="1px",t.reliableMarginRight=!parseFloat((e.getComputedStyle(r,null)||{}).marginRight)),typeof d.style.zoom!==i&&(d.innerHTML="",d.style.cssText=s+"width:1px;padding:1px;display:inline;zoom:1",t.inlineBlockNeedsLayout=3===d.offsetWidth,d.style.display="block",d.innerHTML="<div></div>",d.firstChild.style.width="5px",t.shrinkWrapBlocks=3!==d.offsetWidth,t.inlineBlockNeedsLayout&&(u.style.zoom=1)),u.removeChild(n),n=d=a=r=null)}),n=s=u=l=r=a=null,t}();var O=/(?:\{[\s\S]*\}|\[[\s\S]*\])$/,B=/([A-Z])/g;function P(e,n,r,i){if(b.acceptData(e)){var o,a,s=b.expando,u="string"==typeof n,l=e.nodeType,p=l?b.cache:e,f=l?e[s]:e[s]&&s;if(f&&p[f]&&(i||p[f].data)||!u||r!==t)return f||(l?e[s]=f=c.pop()||b.guid++:f=s),p[f]||(p[f]={},l||(p[f].toJSON=b.noop)),("object"==typeof n||"function"==typeof n)&&(i?p[f]=b.extend(p[f],n):p[f].data=b.extend(p[f].data,n)),o=p[f],i||(o.data||(o.data={}),o=o.data),r!==t&&(o[b.camelCase(n)]=r),u?(a=o[n],null==a&&(a=o[b.camelCase(n)])):a=o,a}}function R(e,t,n){if(b.acceptData(e)){var r,i,o,a=e.nodeType,s=a?b.cache:e,u=a?e[b.expando]:b.expando;if(s[u]){if(t&&(o=n?s[u]:s[u].data)){b.isArray(t)?t=t.concat(b.map(t,b.camelCase)):t in o?t=[t]:(t=b.camelCase(t),t=t in o?[t]:t.split(" "));for(r=0,i=t.length;i>r;r++)delete o[t[r]];if(!(n?$:b.isEmptyObject)(o))return}(n||(delete s[u].data,$(s[u])))&&(a?b.cleanData([e],!0):b.support.deleteExpando||s!=s.window?delete s[u]:s[u]=null)}}}b.extend({cache:{},expando:"jQuery"+(p+Math.random()).replace(/\D/g,""),noData:{embed:!0,object:"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",applet:!0},hasData:function(e){return e=e.nodeType?b.cache[e[b.expando]]:e[b.expando],!!e&&!$(e)},data:function(e,t,n){return P(e,t,n)},removeData:function(e,t){return R(e,t)},_data:function(e,t,n){return P(e,t,n,!0)},_removeData:function(e,t){return R(e,t,!0)},acceptData:function(e){if(e.nodeType&&1!==e.nodeType&&9!==e.nodeType)return!1;var t=e.nodeName&&b.noData[e.nodeName.toLowerCase()];return!t||t!==!0&&e.getAttribute("classid")===t}}),b.fn.extend({data:function(e,n){var r,i,o=this[0],a=0,s=null;if(e===t){if(this.length&&(s=b.data(o),1===o.nodeType&&!b._data(o,"parsedAttrs"))){for(r=o.attributes;r.length>a;a++)i=r[a].name,i.indexOf("data-")||(i=b.camelCase(i.slice(5)),W(o,i,s[i]));b._data(o,"parsedAttrs",!0)}return s}return"object"==typeof e?this.each(function(){b.data(this,e)}):b.access(this,function(n){return n===t?o?W(o,e,b.data(o,e)):null:(this.each(function(){b.data(this,e,n)}),t)},null,n,arguments.length>1,null,!0)},removeData:function(e){return this.each(function(){b.removeData(this,e)})}});function W(e,n,r){if(r===t&&1===e.nodeType){var i="data-"+n.replace(B,"-$1").toLowerCase();if(r=e.getAttribute(i),"string"==typeof r){try{r="true"===r?!0:"false"===r?!1:"null"===r?null:+r+""===r?+r:O.test(r)?b.parseJSON(r):r}catch(o){}b.data(e,n,r)}else r=t}return r}function $(e){var t;for(t in e)if(("data"!==t||!b.isEmptyObject(e[t]))&&"toJSON"!==t)return!1;return!0}b.extend({queue:function(e,n,r){var i;return e?(n=(n||"fx")+"queue",i=b._data(e,n),r&&(!i||b.isArray(r)?i=b._data(e,n,b.makeArray(r)):i.push(r)),i||[]):t},dequeue:function(e,t){t=t||"fx";var n=b.queue(e,t),r=n.length,i=n.shift(),o=b._queueHooks(e,t),a=function(){b.dequeue(e,t)};"inprogress"===i&&(i=n.shift(),r--),o.cur=i,i&&("fx"===t&&n.unshift("inprogress"),delete o.stop,i.call(e,a,o)),!r&&o&&o.empty.fire()},_queueHooks:function(e,t){var n=t+"queueHooks";return b._data(e,n)||b._data(e,n,{empty:b.Callbacks("once memory").add(function(){b._removeData(e,t+"queue"),b._removeData(e,n)})})}}),b.fn.extend({queue:function(e,n){var r=2;return"string"!=typeof e&&(n=e,e="fx",r--),r>arguments.length?b.queue(this[0],e):n===t?this:this.each(function(){var t=b.queue(this,e,n);b._queueHooks(this,e),"fx"===e&&"inprogress"!==t[0]&&b.dequeue(this,e)})},dequeue:function(e){return this.each(function(){b.dequeue(this,e)})},delay:function(e,t){return e=b.fx?b.fx.speeds[e]||e:e,t=t||"fx",this.queue(t,function(t,n){var r=setTimeout(t,e);n.stop=function(){clearTimeout(r)}})},clearQueue:function(e){return this.queue(e||"fx",[])},promise:function(e,n){var r,i=1,o=b.Deferred(),a=this,s=this.length,u=function(){--i||o.resolveWith(a,[a])};"string"!=typeof e&&(n=e,e=t),e=e||"fx";while(s--)r=b._data(a[s],e+"queueHooks"),r&&r.empty&&(i++,r.empty.add(u));return u(),o.promise(n)}});var I,z,X=/[\t\r\n]/g,U=/\r/g,V=/^(?:input|select|textarea|button|object)$/i,Y=/^(?:a|area)$/i,J=/^(?:checked|selected|autofocus|autoplay|async|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped)$/i,G=/^(?:checked|selected)$/i,Q=b.support.getSetAttribute,K=b.support.input;b.fn.extend({attr:function(e,t){return b.access(this,b.attr,e,t,arguments.length>1)},removeAttr:function(e){return this.each(function(){b.removeAttr(this,e)})},prop:function(e,t){return b.access(this,b.prop,e,t,arguments.length>1)},removeProp:function(e){return e=b.propFix[e]||e,this.each(function(){try{this[e]=t,delete this[e]}catch(n){}})},addClass:function(e){var t,n,r,i,o,a=0,s=this.length,u="string"==typeof e&&e;if(b.isFunction(e))return this.each(function(t){b(this).addClass(e.call(this,t,this.className))});if(u)for(t=(e||"").match(w)||[];s>a;a++)if(n=this[a],r=1===n.nodeType&&(n.className?(" "+n.className+" ").replace(X," "):" ")){o=0;while(i=t[o++])0>r.indexOf(" "+i+" ")&&(r+=i+" ");n.className=b.trim(r)}return this},removeClass:function(e){var t,n,r,i,o,a=0,s=this.length,u=0===arguments.length||"string"==typeof e&&e;if(b.isFunction(e))return this.each(function(t){b(this).removeClass(e.call(this,t,this.className))});if(u)for(t=(e||"").match(w)||[];s>a;a++)if(n=this[a],r=1===n.nodeType&&(n.className?(" "+n.className+" ").replace(X," "):"")){o=0;while(i=t[o++])while(r.indexOf(" "+i+" ")>=0)r=r.replace(" "+i+" "," ");n.className=e?b.trim(r):""}return this},toggleClass:function(e,t){var n=typeof e,r="boolean"==typeof t;return b.isFunction(e)?this.each(function(n){b(this).toggleClass(e.call(this,n,this.className,t),t)}):this.each(function(){if("string"===n){var o,a=0,s=b(this),u=t,l=e.match(w)||[];while(o=l[a++])u=r?u:!s.hasClass(o),s[u?"addClass":"removeClass"](o)}else(n===i||"boolean"===n)&&(this.className&&b._data(this,"__className__",this.className),this.className=this.className||e===!1?"":b._data(this,"__className__")||"")})},hasClass:function(e){var t=" "+e+" ",n=0,r=this.length;for(;r>n;n++)if(1===this[n].nodeType&&(" "+this[n].className+" ").replace(X," ").indexOf(t)>=0)return!0;return!1},val:function(e){var n,r,i,o=this[0];{if(arguments.length)return i=b.isFunction(e),this.each(function(n){var o,a=b(this);1===this.nodeType&&(o=i?e.call(this,n,a.val()):e,null==o?o="":"number"==typeof o?o+="":b.isArray(o)&&(o=b.map(o,function(e){return null==e?"":e+""})),r=b.valHooks[this.type]||b.valHooks[this.nodeName.toLowerCase()],r&&"set"in r&&r.set(this,o,"value")!==t||(this.value=o))});if(o)return r=b.valHooks[o.type]||b.valHooks[o.nodeName.toLowerCase()],r&&"get"in r&&(n=r.get(o,"value"))!==t?n:(n=o.value,"string"==typeof n?n.replace(U,""):null==n?"":n)}}}),b.extend({valHooks:{option:{get:function(e){var t=e.attributes.value;return!t||t.specified?e.value:e.text}},select:{get:function(e){var t,n,r=e.options,i=e.selectedIndex,o="select-one"===e.type||0>i,a=o?null:[],s=o?i+1:r.length,u=0>i?s:o?i:0;for(;s>u;u++)if(n=r[u],!(!n.selected&&u!==i||(b.support.optDisabled?n.disabled:null!==n.getAttribute("disabled"))||n.parentNode.disabled&&b.nodeName(n.parentNode,"optgroup"))){if(t=b(n).val(),o)return t;a.push(t)}return a},set:function(e,t){var n=b.makeArray(t);return b(e).find("option").each(function(){this.selected=b.inArray(b(this).val(),n)>=0}),n.length||(e.selectedIndex=-1),n}}},attr:function(e,n,r){var o,a,s,u=e.nodeType;if(e&&3!==u&&8!==u&&2!==u)return typeof e.getAttribute===i?b.prop(e,n,r):(a=1!==u||!b.isXMLDoc(e),a&&(n=n.toLowerCase(),o=b.attrHooks[n]||(J.test(n)?z:I)),r===t?o&&a&&"get"in o&&null!==(s=o.get(e,n))?s:(typeof e.getAttribute!==i&&(s=e.getAttribute(n)),null==s?t:s):null!==r?o&&a&&"set"in o&&(s=o.set(e,r,n))!==t?s:(e.setAttribute(n,r+""),r):(b.removeAttr(e,n),t))},removeAttr:function(e,t){var n,r,i=0,o=t&&t.match(w);if(o&&1===e.nodeType)while(n=o[i++])r=b.propFix[n]||n,J.test(n)?!Q&&G.test(n)?e[b.camelCase("default-"+n)]=e[r]=!1:e[r]=!1:b.attr(e,n,""),e.removeAttribute(Q?n:r)},attrHooks:{type:{set:function(e,t){if(!b.support.radioValue&&"radio"===t&&b.nodeName(e,"input")){var n=e.value;return e.setAttribute("type",t),n&&(e.value=n),t}}}},propFix:{tabindex:"tabIndex",readonly:"readOnly","for":"htmlFor","class":"className",maxlength:"maxLength",cellspacing:"cellSpacing",cellpadding:"cellPadding",rowspan:"rowSpan",colspan:"colSpan",usemap:"useMap",frameborder:"frameBorder",contenteditable:"contentEditable"},prop:function(e,n,r){var i,o,a,s=e.nodeType;if(e&&3!==s&&8!==s&&2!==s)return a=1!==s||!b.isXMLDoc(e),a&&(n=b.propFix[n]||n,o=b.propHooks[n]),r!==t?o&&"set"in o&&(i=o.set(e,r,n))!==t?i:e[n]=r:o&&"get"in o&&null!==(i=o.get(e,n))?i:e[n]},propHooks:{tabIndex:{get:function(e){var n=e.getAttributeNode("tabindex");return n&&n.specified?parseInt(n.value,10):V.test(e.nodeName)||Y.test(e.nodeName)&&e.href?0:t}}}}),z={get:function(e,n){var r=b.prop(e,n),i="boolean"==typeof r&&e.getAttribute(n),o="boolean"==typeof r?K&&Q?null!=i:G.test(n)?e[b.camelCase("default-"+n)]:!!i:e.getAttributeNode(n);return o&&o.value!==!1?n.toLowerCase():t},set:function(e,t,n){return t===!1?b.removeAttr(e,n):K&&Q||!G.test(n)?e.setAttribute(!Q&&b.propFix[n]||n,n):e[b.camelCase("default-"+n)]=e[n]=!0,n}},K&&Q||(b.attrHooks.value={get:function(e,n){var r=e.getAttributeNode(n);return b.nodeName(e,"input")?e.defaultValue:r&&r.specified?r.value:t},set:function(e,n,r){return b.nodeName(e,"input")?(e.defaultValue=n,t):I&&I.set(e,n,r)}}),Q||(I=b.valHooks.button={get:function(e,n){var r=e.getAttributeNode(n);return r&&("id"===n||"name"===n||"coords"===n?""!==r.value:r.specified)?r.value:t},set:function(e,n,r){var i=e.getAttributeNode(r);return i||e.setAttributeNode(i=e.ownerDocument.createAttribute(r)),i.value=n+="","value"===r||n===e.getAttribute(r)?n:t}},b.attrHooks.contenteditable={get:I.get,set:function(e,t,n){I.set(e,""===t?!1:t,n)}},b.each(["width","height"],function(e,n){b.attrHooks[n]=b.extend(b.attrHooks[n],{set:function(e,r){return""===r?(e.setAttribute(n,"auto"),r):t}})})),b.support.hrefNormalized||(b.each(["href","src","width","height"],function(e,n){b.attrHooks[n]=b.extend(b.attrHooks[n],{get:function(e){var r=e.getAttribute(n,2);return null==r?t:r}})}),b.each(["href","src"],function(e,t){b.propHooks[t]={get:function(e){return e.getAttribute(t,4)}}})),b.support.style||(b.attrHooks.style={get:function(e){return e.style.cssText||t},set:function(e,t){return e.style.cssText=t+""}}),b.support.optSelected||(b.propHooks.selected=b.extend(b.propHooks.selected,{get:function(e){var t=e.parentNode;return t&&(t.selectedIndex,t.parentNode&&t.parentNode.selectedIndex),null}})),b.support.enctype||(b.propFix.enctype="encoding"),b.support.checkOn||b.each(["radio","checkbox"],function(){b.valHooks[this]={get:function(e){return null===e.getAttribute("value")?"on":e.value}}}),b.each(["radio","checkbox"],function(){b.valHooks[this]=b.extend(b.valHooks[this],{set:function(e,n){return b.isArray(n)?e.checked=b.inArray(b(e).val(),n)>=0:t}})});var Z=/^(?:input|select|textarea)$/i,et=/^key/,tt=/^(?:mouse|contextmenu)|click/,nt=/^(?:focusinfocus|focusoutblur)$/,rt=/^([^.]*)(?:\.(.+)|)$/;function it(){return!0}function ot(){return!1}b.event={global:{},add:function(e,n,r,o,a){var s,u,l,c,p,f,d,h,g,m,y,v=b._data(e);if(v){r.handler&&(c=r,r=c.handler,a=c.selector),r.guid||(r.guid=b.guid++),(u=v.events)||(u=v.events={}),(f=v.handle)||(f=v.handle=function(e){return typeof b===i||e&&b.event.triggered===e.type?t:b.event.dispatch.apply(f.elem,arguments)},f.elem=e),n=(n||"").match(w)||[""],l=n.length;while(l--)s=rt.exec(n[l])||[],g=y=s[1],m=(s[2]||"").split(".").sort(),p=b.event.special[g]||{},g=(a?p.delegateType:p.bindType)||g,p=b.event.special[g]||{},d=b.extend({type:g,origType:y,data:o,handler:r,guid:r.guid,selector:a,needsContext:a&&b.expr.match.needsContext.test(a),namespace:m.join(".")},c),(h=u[g])||(h=u[g]=[],h.delegateCount=0,p.setup&&p.setup.call(e,o,m,f)!==!1||(e.addEventListener?e.addEventListener(g,f,!1):e.attachEvent&&e.attachEvent("on"+g,f))),p.add&&(p.add.call(e,d),d.handler.guid||(d.handler.guid=r.guid)),a?h.splice(h.delegateCount++,0,d):h.push(d),b.event.global[g]=!0;e=null}},remove:function(e,t,n,r,i){var o,a,s,u,l,c,p,f,d,h,g,m=b.hasData(e)&&b._data(e);if(m&&(c=m.events)){t=(t||"").match(w)||[""],l=t.length;while(l--)if(s=rt.exec(t[l])||[],d=g=s[1],h=(s[2]||"").split(".").sort(),d){p=b.event.special[d]||{},d=(r?p.delegateType:p.bindType)||d,f=c[d]||[],s=s[2]&&RegExp("(^|\\.)"+h.join("\\.(?:.*\\.|)")+"(\\.|$)"),u=o=f.length;while(o--)a=f[o],!i&&g!==a.origType||n&&n.guid!==a.guid||s&&!s.test(a.namespace)||r&&r!==a.selector&&("**"!==r||!a.selector)||(f.splice(o,1),a.selector&&f.delegateCount--,p.remove&&p.remove.call(e,a));u&&!f.length&&(p.teardown&&p.teardown.call(e,h,m.handle)!==!1||b.removeEvent(e,d,m.handle),delete c[d])}else for(d in c)b.event.remove(e,d+t[l],n,r,!0);b.isEmptyObject(c)&&(delete m.handle,b._removeData(e,"events"))}},trigger:function(n,r,i,a){var s,u,l,c,p,f,d,h=[i||o],g=y.call(n,"type")?n.type:n,m=y.call(n,"namespace")?n.namespace.split("."):[];if(l=f=i=i||o,3!==i.nodeType&&8!==i.nodeType&&!nt.test(g+b.event.triggered)&&(g.indexOf(".")>=0&&(m=g.split("."),g=m.shift(),m.sort()),u=0>g.indexOf(":")&&"on"+g,n=n[b.expando]?n:new b.Event(g,"object"==typeof n&&n),n.isTrigger=!0,n.namespace=m.join("."),n.namespace_re=n.namespace?RegExp("(^|\\.)"+m.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,n.result=t,n.target||(n.target=i),r=null==r?[n]:b.makeArray(r,[n]),p=b.event.special[g]||{},a||!p.trigger||p.trigger.apply(i,r)!==!1)){if(!a&&!p.noBubble&&!b.isWindow(i)){for(c=p.delegateType||g,nt.test(c+g)||(l=l.parentNode);l;l=l.parentNode)h.push(l),f=l;f===(i.ownerDocument||o)&&h.push(f.defaultView||f.parentWindow||e)}d=0;while((l=h[d++])&&!n.isPropagationStopped())n.type=d>1?c:p.bindType||g,s=(b._data(l,"events")||{})[n.type]&&b._data(l,"handle"),s&&s.apply(l,r),s=u&&l[u],s&&b.acceptData(l)&&s.apply&&s.apply(l,r)===!1&&n.preventDefault();if(n.type=g,!(a||n.isDefaultPrevented()||p._default&&p._default.apply(i.ownerDocument,r)!==!1||"click"===g&&b.nodeName(i,"a")||!b.acceptData(i)||!u||!i[g]||b.isWindow(i))){f=i[u],f&&(i[u]=null),b.event.triggered=g;try{i[g]()}catch(v){}b.event.triggered=t,f&&(i[u]=f)}return n.result}},dispatch:function(e){e=b.event.fix(e);var n,r,i,o,a,s=[],u=h.call(arguments),l=(b._data(this,"events")||{})[e.type]||[],c=b.event.special[e.type]||{};if(u[0]=e,e.delegateTarget=this,!c.preDispatch||c.preDispatch.call(this,e)!==!1){s=b.event.handlers.call(this,e,l),n=0;while((o=s[n++])&&!e.isPropagationStopped()){e.currentTarget=o.elem,a=0;while((i=o.handlers[a++])&&!e.isImmediatePropagationStopped())(!e.namespace_re||e.namespace_re.test(i.namespace))&&(e.handleObj=i,e.data=i.data,r=((b.event.special[i.origType]||{}).handle||i.handler).apply(o.elem,u),r!==t&&(e.result=r)===!1&&(e.preventDefault(),e.stopPropagation()))}return c.postDispatch&&c.postDispatch.call(this,e),e.result}},handlers:function(e,n){var r,i,o,a,s=[],u=n.delegateCount,l=e.target;if(u&&l.nodeType&&(!e.button||"click"!==e.type))for(;l!=this;l=l.parentNode||this)if(1===l.nodeType&&(l.disabled!==!0||"click"!==e.type)){for(o=[],a=0;u>a;a++)i=n[a],r=i.selector+" ",o[r]===t&&(o[r]=i.needsContext?b(r,this).index(l)>=0:b.find(r,this,null,[l]).length),o[r]&&o.push(i);o.length&&s.push({elem:l,handlers:o})}return n.length>u&&s.push({elem:this,handlers:n.slice(u)}),s},fix:function(e){if(e[b.expando])return e;var t,n,r,i=e.type,a=e,s=this.fixHooks[i];s||(this.fixHooks[i]=s=tt.test(i)?this.mouseHooks:et.test(i)?this.keyHooks:{}),r=s.props?this.props.concat(s.props):this.props,e=new b.Event(a),t=r.length;while(t--)n=r[t],e[n]=a[n];return e.target||(e.target=a.srcElement||o),3===e.target.nodeType&&(e.target=e.target.parentNode),e.metaKey=!!e.metaKey,s.filter?s.filter(e,a):e},props:"altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(e,t){return null==e.which&&(e.which=null!=t.charCode?t.charCode:t.keyCode),e}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(e,n){var r,i,a,s=n.button,u=n.fromElement;return null==e.pageX&&null!=n.clientX&&(i=e.target.ownerDocument||o,a=i.documentElement,r=i.body,e.pageX=n.clientX+(a&&a.scrollLeft||r&&r.scrollLeft||0)-(a&&a.clientLeft||r&&r.clientLeft||0),e.pageY=n.clientY+(a&&a.scrollTop||r&&r.scrollTop||0)-(a&&a.clientTop||r&&r.clientTop||0)),!e.relatedTarget&&u&&(e.relatedTarget=u===e.target?n.toElement:u),e.which||s===t||(e.which=1&s?1:2&s?3:4&s?2:0),e}},special:{load:{noBubble:!0},click:{trigger:function(){return b.nodeName(this,"input")&&"checkbox"===this.type&&this.click?(this.click(),!1):t}},focus:{trigger:function(){if(this!==o.activeElement&&this.focus)try{return this.focus(),!1}catch(e){}},delegateType:"focusin"},blur:{trigger:function(){return this===o.activeElement&&this.blur?(this.blur(),!1):t},delegateType:"focusout"},beforeunload:{postDispatch:function(e){e.result!==t&&(e.originalEvent.returnValue=e.result)}}},simulate:function(e,t,n,r){var i=b.extend(new b.Event,n,{type:e,isSimulated:!0,originalEvent:{}});r?b.event.trigger(i,null,t):b.event.dispatch.call(t,i),i.isDefaultPrevented()&&n.preventDefault()}},b.removeEvent=o.removeEventListener?function(e,t,n){e.removeEventListener&&e.removeEventListener(t,n,!1)}:function(e,t,n){var r="on"+t;e.detachEvent&&(typeof e[r]===i&&(e[r]=null),e.detachEvent(r,n))},b.Event=function(e,n){return this instanceof b.Event?(e&&e.type?(this.originalEvent=e,this.type=e.type,this.isDefaultPrevented=e.defaultPrevented||e.returnValue===!1||e.getPreventDefault&&e.getPreventDefault()?it:ot):this.type=e,n&&b.extend(this,n),this.timeStamp=e&&e.timeStamp||b.now(),this[b.expando]=!0,t):new b.Event(e,n)},b.Event.prototype={isDefaultPrevented:ot,isPropagationStopped:ot,isImmediatePropagationStopped:ot,preventDefault:function(){var e=this.originalEvent;this.isDefaultPrevented=it,e&&(e.preventDefault?e.preventDefault():e.returnValue=!1)},stopPropagation:function(){var e=this.originalEvent;this.isPropagationStopped=it,e&&(e.stopPropagation&&e.stopPropagation(),e.cancelBubble=!0)},stopImmediatePropagation:function(){this.isImmediatePropagationStopped=it,this.stopPropagation()}},b.each({mouseenter:"mouseover",mouseleave:"mouseout"},function(e,t){b.event.special[e]={delegateType:t,bindType:t,handle:function(e){var n,r=this,i=e.relatedTarget,o=e.handleObj;
return(!i||i!==r&&!b.contains(r,i))&&(e.type=o.origType,n=o.handler.apply(this,arguments),e.type=t),n}}}),b.support.submitBubbles||(b.event.special.submit={setup:function(){return b.nodeName(this,"form")?!1:(b.event.add(this,"click._submit keypress._submit",function(e){var n=e.target,r=b.nodeName(n,"input")||b.nodeName(n,"button")?n.form:t;r&&!b._data(r,"submitBubbles")&&(b.event.add(r,"submit._submit",function(e){e._submit_bubble=!0}),b._data(r,"submitBubbles",!0))}),t)},postDispatch:function(e){e._submit_bubble&&(delete e._submit_bubble,this.parentNode&&!e.isTrigger&&b.event.simulate("submit",this.parentNode,e,!0))},teardown:function(){return b.nodeName(this,"form")?!1:(b.event.remove(this,"._submit"),t)}}),b.support.changeBubbles||(b.event.special.change={setup:function(){return Z.test(this.nodeName)?(("checkbox"===this.type||"radio"===this.type)&&(b.event.add(this,"propertychange._change",function(e){"checked"===e.originalEvent.propertyName&&(this._just_changed=!0)}),b.event.add(this,"click._change",function(e){this._just_changed&&!e.isTrigger&&(this._just_changed=!1),b.event.simulate("change",this,e,!0)})),!1):(b.event.add(this,"beforeactivate._change",function(e){var t=e.target;Z.test(t.nodeName)&&!b._data(t,"changeBubbles")&&(b.event.add(t,"change._change",function(e){!this.parentNode||e.isSimulated||e.isTrigger||b.event.simulate("change",this.parentNode,e,!0)}),b._data(t,"changeBubbles",!0))}),t)},handle:function(e){var n=e.target;return this!==n||e.isSimulated||e.isTrigger||"radio"!==n.type&&"checkbox"!==n.type?e.handleObj.handler.apply(this,arguments):t},teardown:function(){return b.event.remove(this,"._change"),!Z.test(this.nodeName)}}),b.support.focusinBubbles||b.each({focus:"focusin",blur:"focusout"},function(e,t){var n=0,r=function(e){b.event.simulate(t,e.target,b.event.fix(e),!0)};b.event.special[t]={setup:function(){0===n++&&o.addEventListener(e,r,!0)},teardown:function(){0===--n&&o.removeEventListener(e,r,!0)}}}),b.fn.extend({on:function(e,n,r,i,o){var a,s;if("object"==typeof e){"string"!=typeof n&&(r=r||n,n=t);for(a in e)this.on(a,n,r,e[a],o);return this}if(null==r&&null==i?(i=n,r=n=t):null==i&&("string"==typeof n?(i=r,r=t):(i=r,r=n,n=t)),i===!1)i=ot;else if(!i)return this;return 1===o&&(s=i,i=function(e){return b().off(e),s.apply(this,arguments)},i.guid=s.guid||(s.guid=b.guid++)),this.each(function(){b.event.add(this,e,i,r,n)})},one:function(e,t,n,r){return this.on(e,t,n,r,1)},off:function(e,n,r){var i,o;if(e&&e.preventDefault&&e.handleObj)return i=e.handleObj,b(e.delegateTarget).off(i.namespace?i.origType+"."+i.namespace:i.origType,i.selector,i.handler),this;if("object"==typeof e){for(o in e)this.off(o,n,e[o]);return this}return(n===!1||"function"==typeof n)&&(r=n,n=t),r===!1&&(r=ot),this.each(function(){b.event.remove(this,e,r,n)})},bind:function(e,t,n){return this.on(e,null,t,n)},unbind:function(e,t){return this.off(e,null,t)},delegate:function(e,t,n,r){return this.on(t,e,n,r)},undelegate:function(e,t,n){return 1===arguments.length?this.off(e,"**"):this.off(t,e||"**",n)},trigger:function(e,t){return this.each(function(){b.event.trigger(e,t,this)})},triggerHandler:function(e,n){var r=this[0];return r?b.event.trigger(e,n,r,!0):t}}),function(e,t){var n,r,i,o,a,s,u,l,c,p,f,d,h,g,m,y,v,x="sizzle"+-new Date,w=e.document,T={},N=0,C=0,k=it(),E=it(),S=it(),A=typeof t,j=1<<31,D=[],L=D.pop,H=D.push,q=D.slice,M=D.indexOf||function(e){var t=0,n=this.length;for(;n>t;t++)if(this[t]===e)return t;return-1},_="[\\x20\\t\\r\\n\\f]",F="(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",O=F.replace("w","w#"),B="([*^$|!~]?=)",P="\\["+_+"*("+F+")"+_+"*(?:"+B+_+"*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|("+O+")|)|)"+_+"*\\]",R=":("+F+")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|"+P.replace(3,8)+")*)|.*)\\)|)",W=RegExp("^"+_+"+|((?:^|[^\\\\])(?:\\\\.)*)"+_+"+$","g"),$=RegExp("^"+_+"*,"+_+"*"),I=RegExp("^"+_+"*([\\x20\\t\\r\\n\\f>+~])"+_+"*"),z=RegExp(R),X=RegExp("^"+O+"$"),U={ID:RegExp("^#("+F+")"),CLASS:RegExp("^\\.("+F+")"),NAME:RegExp("^\\[name=['\"]?("+F+")['\"]?\\]"),TAG:RegExp("^("+F.replace("w","w*")+")"),ATTR:RegExp("^"+P),PSEUDO:RegExp("^"+R),CHILD:RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+_+"*(even|odd|(([+-]|)(\\d*)n|)"+_+"*(?:([+-]|)"+_+"*(\\d+)|))"+_+"*\\)|)","i"),needsContext:RegExp("^"+_+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+_+"*((?:-\\d)?\\d*)"+_+"*\\)|)(?=[^-]|$)","i")},V=/[\x20\t\r\n\f]*[+~]/,Y=/^[^{]+\{\s*\[native code/,J=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,G=/^(?:input|select|textarea|button)$/i,Q=/^h\d$/i,K=/'|\\/g,Z=/\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,et=/\\([\da-fA-F]{1,6}[\x20\t\r\n\f]?|.)/g,tt=function(e,t){var n="0x"+t-65536;return n!==n?t:0>n?String.fromCharCode(n+65536):String.fromCharCode(55296|n>>10,56320|1023&n)};try{q.call(w.documentElement.childNodes,0)[0].nodeType}catch(nt){q=function(e){var t,n=[];while(t=this[e++])n.push(t);return n}}function rt(e){return Y.test(e+"")}function it(){var e,t=[];return e=function(n,r){return t.push(n+=" ")>i.cacheLength&&delete e[t.shift()],e[n]=r}}function ot(e){return e[x]=!0,e}function at(e){var t=p.createElement("div");try{return e(t)}catch(n){return!1}finally{t=null}}function st(e,t,n,r){var i,o,a,s,u,l,f,g,m,v;if((t?t.ownerDocument||t:w)!==p&&c(t),t=t||p,n=n||[],!e||"string"!=typeof e)return n;if(1!==(s=t.nodeType)&&9!==s)return[];if(!d&&!r){if(i=J.exec(e))if(a=i[1]){if(9===s){if(o=t.getElementById(a),!o||!o.parentNode)return n;if(o.id===a)return n.push(o),n}else if(t.ownerDocument&&(o=t.ownerDocument.getElementById(a))&&y(t,o)&&o.id===a)return n.push(o),n}else{if(i[2])return H.apply(n,q.call(t.getElementsByTagName(e),0)),n;if((a=i[3])&&T.getByClassName&&t.getElementsByClassName)return H.apply(n,q.call(t.getElementsByClassName(a),0)),n}if(T.qsa&&!h.test(e)){if(f=!0,g=x,m=t,v=9===s&&e,1===s&&"object"!==t.nodeName.toLowerCase()){l=ft(e),(f=t.getAttribute("id"))?g=f.replace(K,"\\$&"):t.setAttribute("id",g),g="[id='"+g+"'] ",u=l.length;while(u--)l[u]=g+dt(l[u]);m=V.test(e)&&t.parentNode||t,v=l.join(",")}if(v)try{return H.apply(n,q.call(m.querySelectorAll(v),0)),n}catch(b){}finally{f||t.removeAttribute("id")}}}return wt(e.replace(W,"$1"),t,n,r)}a=st.isXML=function(e){var t=e&&(e.ownerDocument||e).documentElement;return t?"HTML"!==t.nodeName:!1},c=st.setDocument=function(e){var n=e?e.ownerDocument||e:w;return n!==p&&9===n.nodeType&&n.documentElement?(p=n,f=n.documentElement,d=a(n),T.tagNameNoComments=at(function(e){return e.appendChild(n.createComment("")),!e.getElementsByTagName("*").length}),T.attributes=at(function(e){e.innerHTML="<select></select>";var t=typeof e.lastChild.getAttribute("multiple");return"boolean"!==t&&"string"!==t}),T.getByClassName=at(function(e){return e.innerHTML="<div class='hidden e'></div><div class='hidden'></div>",e.getElementsByClassName&&e.getElementsByClassName("e").length?(e.lastChild.className="e",2===e.getElementsByClassName("e").length):!1}),T.getByName=at(function(e){e.id=x+0,e.innerHTML="<a name='"+x+"'></a><div name='"+x+"'></div>",f.insertBefore(e,f.firstChild);var t=n.getElementsByName&&n.getElementsByName(x).length===2+n.getElementsByName(x+0).length;return T.getIdNotName=!n.getElementById(x),f.removeChild(e),t}),i.attrHandle=at(function(e){return e.innerHTML="<a href='#'></a>",e.firstChild&&typeof e.firstChild.getAttribute!==A&&"#"===e.firstChild.getAttribute("href")})?{}:{href:function(e){return e.getAttribute("href",2)},type:function(e){return e.getAttribute("type")}},T.getIdNotName?(i.find.ID=function(e,t){if(typeof t.getElementById!==A&&!d){var n=t.getElementById(e);return n&&n.parentNode?[n]:[]}},i.filter.ID=function(e){var t=e.replace(et,tt);return function(e){return e.getAttribute("id")===t}}):(i.find.ID=function(e,n){if(typeof n.getElementById!==A&&!d){var r=n.getElementById(e);return r?r.id===e||typeof r.getAttributeNode!==A&&r.getAttributeNode("id").value===e?[r]:t:[]}},i.filter.ID=function(e){var t=e.replace(et,tt);return function(e){var n=typeof e.getAttributeNode!==A&&e.getAttributeNode("id");return n&&n.value===t}}),i.find.TAG=T.tagNameNoComments?function(e,n){return typeof n.getElementsByTagName!==A?n.getElementsByTagName(e):t}:function(e,t){var n,r=[],i=0,o=t.getElementsByTagName(e);if("*"===e){while(n=o[i++])1===n.nodeType&&r.push(n);return r}return o},i.find.NAME=T.getByName&&function(e,n){return typeof n.getElementsByName!==A?n.getElementsByName(name):t},i.find.CLASS=T.getByClassName&&function(e,n){return typeof n.getElementsByClassName===A||d?t:n.getElementsByClassName(e)},g=[],h=[":focus"],(T.qsa=rt(n.querySelectorAll))&&(at(function(e){e.innerHTML="<select><option selected=''></option></select>",e.querySelectorAll("[selected]").length||h.push("\\["+_+"*(?:checked|disabled|ismap|multiple|readonly|selected|value)"),e.querySelectorAll(":checked").length||h.push(":checked")}),at(function(e){e.innerHTML="<input type='hidden' i=''/>",e.querySelectorAll("[i^='']").length&&h.push("[*^$]="+_+"*(?:\"\"|'')"),e.querySelectorAll(":enabled").length||h.push(":enabled",":disabled"),e.querySelectorAll("*,:x"),h.push(",.*:")})),(T.matchesSelector=rt(m=f.matchesSelector||f.mozMatchesSelector||f.webkitMatchesSelector||f.oMatchesSelector||f.msMatchesSelector))&&at(function(e){T.disconnectedMatch=m.call(e,"div"),m.call(e,"[s!='']:x"),g.push("!=",R)}),h=RegExp(h.join("|")),g=RegExp(g.join("|")),y=rt(f.contains)||f.compareDocumentPosition?function(e,t){var n=9===e.nodeType?e.documentElement:e,r=t&&t.parentNode;return e===r||!(!r||1!==r.nodeType||!(n.contains?n.contains(r):e.compareDocumentPosition&&16&e.compareDocumentPosition(r)))}:function(e,t){if(t)while(t=t.parentNode)if(t===e)return!0;return!1},v=f.compareDocumentPosition?function(e,t){var r;return e===t?(u=!0,0):(r=t.compareDocumentPosition&&e.compareDocumentPosition&&e.compareDocumentPosition(t))?1&r||e.parentNode&&11===e.parentNode.nodeType?e===n||y(w,e)?-1:t===n||y(w,t)?1:0:4&r?-1:1:e.compareDocumentPosition?-1:1}:function(e,t){var r,i=0,o=e.parentNode,a=t.parentNode,s=[e],l=[t];if(e===t)return u=!0,0;if(!o||!a)return e===n?-1:t===n?1:o?-1:a?1:0;if(o===a)return ut(e,t);r=e;while(r=r.parentNode)s.unshift(r);r=t;while(r=r.parentNode)l.unshift(r);while(s[i]===l[i])i++;return i?ut(s[i],l[i]):s[i]===w?-1:l[i]===w?1:0},u=!1,[0,0].sort(v),T.detectDuplicates=u,p):p},st.matches=function(e,t){return st(e,null,null,t)},st.matchesSelector=function(e,t){if((e.ownerDocument||e)!==p&&c(e),t=t.replace(Z,"='$1']"),!(!T.matchesSelector||d||g&&g.test(t)||h.test(t)))try{var n=m.call(e,t);if(n||T.disconnectedMatch||e.document&&11!==e.document.nodeType)return n}catch(r){}return st(t,p,null,[e]).length>0},st.contains=function(e,t){return(e.ownerDocument||e)!==p&&c(e),y(e,t)},st.attr=function(e,t){var n;return(e.ownerDocument||e)!==p&&c(e),d||(t=t.toLowerCase()),(n=i.attrHandle[t])?n(e):d||T.attributes?e.getAttribute(t):((n=e.getAttributeNode(t))||e.getAttribute(t))&&e[t]===!0?t:n&&n.specified?n.value:null},st.error=function(e){throw Error("Syntax error, unrecognized expression: "+e)},st.uniqueSort=function(e){var t,n=[],r=1,i=0;if(u=!T.detectDuplicates,e.sort(v),u){for(;t=e[r];r++)t===e[r-1]&&(i=n.push(r));while(i--)e.splice(n[i],1)}return e};function ut(e,t){var n=t&&e,r=n&&(~t.sourceIndex||j)-(~e.sourceIndex||j);if(r)return r;if(n)while(n=n.nextSibling)if(n===t)return-1;return e?1:-1}function lt(e){return function(t){var n=t.nodeName.toLowerCase();return"input"===n&&t.type===e}}function ct(e){return function(t){var n=t.nodeName.toLowerCase();return("input"===n||"button"===n)&&t.type===e}}function pt(e){return ot(function(t){return t=+t,ot(function(n,r){var i,o=e([],n.length,t),a=o.length;while(a--)n[i=o[a]]&&(n[i]=!(r[i]=n[i]))})})}o=st.getText=function(e){var t,n="",r=0,i=e.nodeType;if(i){if(1===i||9===i||11===i){if("string"==typeof e.textContent)return e.textContent;for(e=e.firstChild;e;e=e.nextSibling)n+=o(e)}else if(3===i||4===i)return e.nodeValue}else for(;t=e[r];r++)n+=o(t);return n},i=st.selectors={cacheLength:50,createPseudo:ot,match:U,find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(e){return e[1]=e[1].replace(et,tt),e[3]=(e[4]||e[5]||"").replace(et,tt),"~="===e[2]&&(e[3]=" "+e[3]+" "),e.slice(0,4)},CHILD:function(e){return e[1]=e[1].toLowerCase(),"nth"===e[1].slice(0,3)?(e[3]||st.error(e[0]),e[4]=+(e[4]?e[5]+(e[6]||1):2*("even"===e[3]||"odd"===e[3])),e[5]=+(e[7]+e[8]||"odd"===e[3])):e[3]&&st.error(e[0]),e},PSEUDO:function(e){var t,n=!e[5]&&e[2];return U.CHILD.test(e[0])?null:(e[4]?e[2]=e[4]:n&&z.test(n)&&(t=ft(n,!0))&&(t=n.indexOf(")",n.length-t)-n.length)&&(e[0]=e[0].slice(0,t),e[2]=n.slice(0,t)),e.slice(0,3))}},filter:{TAG:function(e){return"*"===e?function(){return!0}:(e=e.replace(et,tt).toLowerCase(),function(t){return t.nodeName&&t.nodeName.toLowerCase()===e})},CLASS:function(e){var t=k[e+" "];return t||(t=RegExp("(^|"+_+")"+e+"("+_+"|$)"))&&k(e,function(e){return t.test(e.className||typeof e.getAttribute!==A&&e.getAttribute("class")||"")})},ATTR:function(e,t,n){return function(r){var i=st.attr(r,e);return null==i?"!="===t:t?(i+="","="===t?i===n:"!="===t?i!==n:"^="===t?n&&0===i.indexOf(n):"*="===t?n&&i.indexOf(n)>-1:"$="===t?n&&i.slice(-n.length)===n:"~="===t?(" "+i+" ").indexOf(n)>-1:"|="===t?i===n||i.slice(0,n.length+1)===n+"-":!1):!0}},CHILD:function(e,t,n,r,i){var o="nth"!==e.slice(0,3),a="last"!==e.slice(-4),s="of-type"===t;return 1===r&&0===i?function(e){return!!e.parentNode}:function(t,n,u){var l,c,p,f,d,h,g=o!==a?"nextSibling":"previousSibling",m=t.parentNode,y=s&&t.nodeName.toLowerCase(),v=!u&&!s;if(m){if(o){while(g){p=t;while(p=p[g])if(s?p.nodeName.toLowerCase()===y:1===p.nodeType)return!1;h=g="only"===e&&!h&&"nextSibling"}return!0}if(h=[a?m.firstChild:m.lastChild],a&&v){c=m[x]||(m[x]={}),l=c[e]||[],d=l[0]===N&&l[1],f=l[0]===N&&l[2],p=d&&m.childNodes[d];while(p=++d&&p&&p[g]||(f=d=0)||h.pop())if(1===p.nodeType&&++f&&p===t){c[e]=[N,d,f];break}}else if(v&&(l=(t[x]||(t[x]={}))[e])&&l[0]===N)f=l[1];else while(p=++d&&p&&p[g]||(f=d=0)||h.pop())if((s?p.nodeName.toLowerCase()===y:1===p.nodeType)&&++f&&(v&&((p[x]||(p[x]={}))[e]=[N,f]),p===t))break;return f-=i,f===r||0===f%r&&f/r>=0}}},PSEUDO:function(e,t){var n,r=i.pseudos[e]||i.setFilters[e.toLowerCase()]||st.error("unsupported pseudo: "+e);return r[x]?r(t):r.length>1?(n=[e,e,"",t],i.setFilters.hasOwnProperty(e.toLowerCase())?ot(function(e,n){var i,o=r(e,t),a=o.length;while(a--)i=M.call(e,o[a]),e[i]=!(n[i]=o[a])}):function(e){return r(e,0,n)}):r}},pseudos:{not:ot(function(e){var t=[],n=[],r=s(e.replace(W,"$1"));return r[x]?ot(function(e,t,n,i){var o,a=r(e,null,i,[]),s=e.length;while(s--)(o=a[s])&&(e[s]=!(t[s]=o))}):function(e,i,o){return t[0]=e,r(t,null,o,n),!n.pop()}}),has:ot(function(e){return function(t){return st(e,t).length>0}}),contains:ot(function(e){return function(t){return(t.textContent||t.innerText||o(t)).indexOf(e)>-1}}),lang:ot(function(e){return X.test(e||"")||st.error("unsupported lang: "+e),e=e.replace(et,tt).toLowerCase(),function(t){var n;do if(n=d?t.getAttribute("xml:lang")||t.getAttribute("lang"):t.lang)return n=n.toLowerCase(),n===e||0===n.indexOf(e+"-");while((t=t.parentNode)&&1===t.nodeType);return!1}}),target:function(t){var n=e.location&&e.location.hash;return n&&n.slice(1)===t.id},root:function(e){return e===f},focus:function(e){return e===p.activeElement&&(!p.hasFocus||p.hasFocus())&&!!(e.type||e.href||~e.tabIndex)},enabled:function(e){return e.disabled===!1},disabled:function(e){return e.disabled===!0},checked:function(e){var t=e.nodeName.toLowerCase();return"input"===t&&!!e.checked||"option"===t&&!!e.selected},selected:function(e){return e.parentNode&&e.parentNode.selectedIndex,e.selected===!0},empty:function(e){for(e=e.firstChild;e;e=e.nextSibling)if(e.nodeName>"@"||3===e.nodeType||4===e.nodeType)return!1;return!0},parent:function(e){return!i.pseudos.empty(e)},header:function(e){return Q.test(e.nodeName)},input:function(e){return G.test(e.nodeName)},button:function(e){var t=e.nodeName.toLowerCase();return"input"===t&&"button"===e.type||"button"===t},text:function(e){var t;return"input"===e.nodeName.toLowerCase()&&"text"===e.type&&(null==(t=e.getAttribute("type"))||t.toLowerCase()===e.type)},first:pt(function(){return[0]}),last:pt(function(e,t){return[t-1]}),eq:pt(function(e,t,n){return[0>n?n+t:n]}),even:pt(function(e,t){var n=0;for(;t>n;n+=2)e.push(n);return e}),odd:pt(function(e,t){var n=1;for(;t>n;n+=2)e.push(n);return e}),lt:pt(function(e,t,n){var r=0>n?n+t:n;for(;--r>=0;)e.push(r);return e}),gt:pt(function(e,t,n){var r=0>n?n+t:n;for(;t>++r;)e.push(r);return e})}};for(n in{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})i.pseudos[n]=lt(n);for(n in{submit:!0,reset:!0})i.pseudos[n]=ct(n);function ft(e,t){var n,r,o,a,s,u,l,c=E[e+" "];if(c)return t?0:c.slice(0);s=e,u=[],l=i.preFilter;while(s){(!n||(r=$.exec(s)))&&(r&&(s=s.slice(r[0].length)||s),u.push(o=[])),n=!1,(r=I.exec(s))&&(n=r.shift(),o.push({value:n,type:r[0].replace(W," ")}),s=s.slice(n.length));for(a in i.filter)!(r=U[a].exec(s))||l[a]&&!(r=l[a](r))||(n=r.shift(),o.push({value:n,type:a,matches:r}),s=s.slice(n.length));if(!n)break}return t?s.length:s?st.error(e):E(e,u).slice(0)}function dt(e){var t=0,n=e.length,r="";for(;n>t;t++)r+=e[t].value;return r}function ht(e,t,n){var i=t.dir,o=n&&"parentNode"===i,a=C++;return t.first?function(t,n,r){while(t=t[i])if(1===t.nodeType||o)return e(t,n,r)}:function(t,n,s){var u,l,c,p=N+" "+a;if(s){while(t=t[i])if((1===t.nodeType||o)&&e(t,n,s))return!0}else while(t=t[i])if(1===t.nodeType||o)if(c=t[x]||(t[x]={}),(l=c[i])&&l[0]===p){if((u=l[1])===!0||u===r)return u===!0}else if(l=c[i]=[p],l[1]=e(t,n,s)||r,l[1]===!0)return!0}}function gt(e){return e.length>1?function(t,n,r){var i=e.length;while(i--)if(!e[i](t,n,r))return!1;return!0}:e[0]}function mt(e,t,n,r,i){var o,a=[],s=0,u=e.length,l=null!=t;for(;u>s;s++)(o=e[s])&&(!n||n(o,r,i))&&(a.push(o),l&&t.push(s));return a}function yt(e,t,n,r,i,o){return r&&!r[x]&&(r=yt(r)),i&&!i[x]&&(i=yt(i,o)),ot(function(o,a,s,u){var l,c,p,f=[],d=[],h=a.length,g=o||xt(t||"*",s.nodeType?[s]:s,[]),m=!e||!o&&t?g:mt(g,f,e,s,u),y=n?i||(o?e:h||r)?[]:a:m;if(n&&n(m,y,s,u),r){l=mt(y,d),r(l,[],s,u),c=l.length;while(c--)(p=l[c])&&(y[d[c]]=!(m[d[c]]=p))}if(o){if(i||e){if(i){l=[],c=y.length;while(c--)(p=y[c])&&l.push(m[c]=p);i(null,y=[],l,u)}c=y.length;while(c--)(p=y[c])&&(l=i?M.call(o,p):f[c])>-1&&(o[l]=!(a[l]=p))}}else y=mt(y===a?y.splice(h,y.length):y),i?i(null,a,y,u):H.apply(a,y)})}function vt(e){var t,n,r,o=e.length,a=i.relative[e[0].type],s=a||i.relative[" "],u=a?1:0,c=ht(function(e){return e===t},s,!0),p=ht(function(e){return M.call(t,e)>-1},s,!0),f=[function(e,n,r){return!a&&(r||n!==l)||((t=n).nodeType?c(e,n,r):p(e,n,r))}];for(;o>u;u++)if(n=i.relative[e[u].type])f=[ht(gt(f),n)];else{if(n=i.filter[e[u].type].apply(null,e[u].matches),n[x]){for(r=++u;o>r;r++)if(i.relative[e[r].type])break;return yt(u>1&&gt(f),u>1&&dt(e.slice(0,u-1)).replace(W,"$1"),n,r>u&&vt(e.slice(u,r)),o>r&&vt(e=e.slice(r)),o>r&&dt(e))}f.push(n)}return gt(f)}function bt(e,t){var n=0,o=t.length>0,a=e.length>0,s=function(s,u,c,f,d){var h,g,m,y=[],v=0,b="0",x=s&&[],w=null!=d,T=l,C=s||a&&i.find.TAG("*",d&&u.parentNode||u),k=N+=null==T?1:Math.random()||.1;for(w&&(l=u!==p&&u,r=n);null!=(h=C[b]);b++){if(a&&h){g=0;while(m=e[g++])if(m(h,u,c)){f.push(h);break}w&&(N=k,r=++n)}o&&((h=!m&&h)&&v--,s&&x.push(h))}if(v+=b,o&&b!==v){g=0;while(m=t[g++])m(x,y,u,c);if(s){if(v>0)while(b--)x[b]||y[b]||(y[b]=L.call(f));y=mt(y)}H.apply(f,y),w&&!s&&y.length>0&&v+t.length>1&&st.uniqueSort(f)}return w&&(N=k,l=T),x};return o?ot(s):s}s=st.compile=function(e,t){var n,r=[],i=[],o=S[e+" "];if(!o){t||(t=ft(e)),n=t.length;while(n--)o=vt(t[n]),o[x]?r.push(o):i.push(o);o=S(e,bt(i,r))}return o};function xt(e,t,n){var r=0,i=t.length;for(;i>r;r++)st(e,t[r],n);return n}function wt(e,t,n,r){var o,a,u,l,c,p=ft(e);if(!r&&1===p.length){if(a=p[0]=p[0].slice(0),a.length>2&&"ID"===(u=a[0]).type&&9===t.nodeType&&!d&&i.relative[a[1].type]){if(t=i.find.ID(u.matches[0].replace(et,tt),t)[0],!t)return n;e=e.slice(a.shift().value.length)}o=U.needsContext.test(e)?0:a.length;while(o--){if(u=a[o],i.relative[l=u.type])break;if((c=i.find[l])&&(r=c(u.matches[0].replace(et,tt),V.test(a[0].type)&&t.parentNode||t))){if(a.splice(o,1),e=r.length&&dt(a),!e)return H.apply(n,q.call(r,0)),n;break}}}return s(e,p)(r,t,d,n,V.test(e)),n}i.pseudos.nth=i.pseudos.eq;function Tt(){}i.filters=Tt.prototype=i.pseudos,i.setFilters=new Tt,c(),st.attr=b.attr,b.find=st,b.expr=st.selectors,b.expr[":"]=b.expr.pseudos,b.unique=st.uniqueSort,b.text=st.getText,b.isXMLDoc=st.isXML,b.contains=st.contains}(e);var at=/Until$/,st=/^(?:parents|prev(?:Until|All))/,ut=/^.[^:#\[\.,]*$/,lt=b.expr.match.needsContext,ct={children:!0,contents:!0,next:!0,prev:!0};b.fn.extend({find:function(e){var t,n,r,i=this.length;if("string"!=typeof e)return r=this,this.pushStack(b(e).filter(function(){for(t=0;i>t;t++)if(b.contains(r[t],this))return!0}));for(n=[],t=0;i>t;t++)b.find(e,this[t],n);return n=this.pushStack(i>1?b.unique(n):n),n.selector=(this.selector?this.selector+" ":"")+e,n},has:function(e){var t,n=b(e,this),r=n.length;return this.filter(function(){for(t=0;r>t;t++)if(b.contains(this,n[t]))return!0})},not:function(e){return this.pushStack(ft(this,e,!1))},filter:function(e){return this.pushStack(ft(this,e,!0))},is:function(e){return!!e&&("string"==typeof e?lt.test(e)?b(e,this.context).index(this[0])>=0:b.filter(e,this).length>0:this.filter(e).length>0)},closest:function(e,t){var n,r=0,i=this.length,o=[],a=lt.test(e)||"string"!=typeof e?b(e,t||this.context):0;for(;i>r;r++){n=this[r];while(n&&n.ownerDocument&&n!==t&&11!==n.nodeType){if(a?a.index(n)>-1:b.find.matchesSelector(n,e)){o.push(n);break}n=n.parentNode}}return this.pushStack(o.length>1?b.unique(o):o)},index:function(e){return e?"string"==typeof e?b.inArray(this[0],b(e)):b.inArray(e.jquery?e[0]:e,this):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(e,t){var n="string"==typeof e?b(e,t):b.makeArray(e&&e.nodeType?[e]:e),r=b.merge(this.get(),n);return this.pushStack(b.unique(r))},addBack:function(e){return this.add(null==e?this.prevObject:this.prevObject.filter(e))}}),b.fn.andSelf=b.fn.addBack;function pt(e,t){do e=e[t];while(e&&1!==e.nodeType);return e}b.each({parent:function(e){var t=e.parentNode;return t&&11!==t.nodeType?t:null},parents:function(e){return b.dir(e,"parentNode")},parentsUntil:function(e,t,n){return b.dir(e,"parentNode",n)},next:function(e){return pt(e,"nextSibling")},prev:function(e){return pt(e,"previousSibling")},nextAll:function(e){return b.dir(e,"nextSibling")},prevAll:function(e){return b.dir(e,"previousSibling")},nextUntil:function(e,t,n){return b.dir(e,"nextSibling",n)},prevUntil:function(e,t,n){return b.dir(e,"previousSibling",n)},siblings:function(e){return b.sibling((e.parentNode||{}).firstChild,e)},children:function(e){return b.sibling(e.firstChild)},contents:function(e){return b.nodeName(e,"iframe")?e.contentDocument||e.contentWindow.document:b.merge([],e.childNodes)}},function(e,t){b.fn[e]=function(n,r){var i=b.map(this,t,n);return at.test(e)||(r=n),r&&"string"==typeof r&&(i=b.filter(r,i)),i=this.length>1&&!ct[e]?b.unique(i):i,this.length>1&&st.test(e)&&(i=i.reverse()),this.pushStack(i)}}),b.extend({filter:function(e,t,n){return n&&(e=":not("+e+")"),1===t.length?b.find.matchesSelector(t[0],e)?[t[0]]:[]:b.find.matches(e,t)},dir:function(e,n,r){var i=[],o=e[n];while(o&&9!==o.nodeType&&(r===t||1!==o.nodeType||!b(o).is(r)))1===o.nodeType&&i.push(o),o=o[n];return i},sibling:function(e,t){var n=[];for(;e;e=e.nextSibling)1===e.nodeType&&e!==t&&n.push(e);return n}});function ft(e,t,n){if(t=t||0,b.isFunction(t))return b.grep(e,function(e,r){var i=!!t.call(e,r,e);return i===n});if(t.nodeType)return b.grep(e,function(e){return e===t===n});if("string"==typeof t){var r=b.grep(e,function(e){return 1===e.nodeType});if(ut.test(t))return b.filter(t,r,!n);t=b.filter(t,r)}return b.grep(e,function(e){return b.inArray(e,t)>=0===n})}function dt(e){var t=ht.split("|"),n=e.createDocumentFragment();if(n.createElement)while(t.length)n.createElement(t.pop());return n}var ht="abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",gt=/ jQuery\d+="(?:null|\d+)"/g,mt=RegExp("<(?:"+ht+")[\\s/>]","i"),yt=/^\s+/,vt=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,bt=/<([\w:]+)/,xt=/<tbody/i,wt=/<|&#?\w+;/,Tt=/<(?:script|style|link)/i,Nt=/^(?:checkbox|radio)$/i,Ct=/checked\s*(?:[^=]|=\s*.checked.)/i,kt=/^$|\/(?:java|ecma)script/i,Et=/^true\/(.*)/,St=/^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,At={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],area:[1,"<map>","</map>"],param:[1,"<object>","</object>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:b.support.htmlSerialize?[0,"",""]:[1,"X<div>","</div>"]},jt=dt(o),Dt=jt.appendChild(o.createElement("div"));At.optgroup=At.option,At.tbody=At.tfoot=At.colgroup=At.caption=At.thead,At.th=At.td,b.fn.extend({text:function(e){return b.access(this,function(e){return e===t?b.text(this):this.empty().append((this[0]&&this[0].ownerDocument||o).createTextNode(e))},null,e,arguments.length)},wrapAll:function(e){if(b.isFunction(e))return this.each(function(t){b(this).wrapAll(e.call(this,t))});if(this[0]){var t=b(e,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&t.insertBefore(this[0]),t.map(function(){var e=this;while(e.firstChild&&1===e.firstChild.nodeType)e=e.firstChild;return e}).append(this)}return this},wrapInner:function(e){return b.isFunction(e)?this.each(function(t){b(this).wrapInner(e.call(this,t))}):this.each(function(){var t=b(this),n=t.contents();n.length?n.wrapAll(e):t.append(e)})},wrap:function(e){var t=b.isFunction(e);return this.each(function(n){b(this).wrapAll(t?e.call(this,n):e)})},unwrap:function(){return this.parent().each(function(){b.nodeName(this,"body")||b(this).replaceWith(this.childNodes)}).end()},append:function(){return this.domManip(arguments,!0,function(e){(1===this.nodeType||11===this.nodeType||9===this.nodeType)&&this.appendChild(e)})},prepend:function(){return this.domManip(arguments,!0,function(e){(1===this.nodeType||11===this.nodeType||9===this.nodeType)&&this.insertBefore(e,this.firstChild)})},before:function(){return this.domManip(arguments,!1,function(e){this.parentNode&&this.parentNode.insertBefore(e,this)})},after:function(){return this.domManip(arguments,!1,function(e){this.parentNode&&this.parentNode.insertBefore(e,this.nextSibling)})},remove:function(e,t){var n,r=0;for(;null!=(n=this[r]);r++)(!e||b.filter(e,[n]).length>0)&&(t||1!==n.nodeType||b.cleanData(Ot(n)),n.parentNode&&(t&&b.contains(n.ownerDocument,n)&&Mt(Ot(n,"script")),n.parentNode.removeChild(n)));return this},empty:function(){var e,t=0;for(;null!=(e=this[t]);t++){1===e.nodeType&&b.cleanData(Ot(e,!1));while(e.firstChild)e.removeChild(e.firstChild);e.options&&b.nodeName(e,"select")&&(e.options.length=0)}return this},clone:function(e,t){return e=null==e?!1:e,t=null==t?e:t,this.map(function(){return b.clone(this,e,t)})},html:function(e){return b.access(this,function(e){var n=this[0]||{},r=0,i=this.length;if(e===t)return 1===n.nodeType?n.innerHTML.replace(gt,""):t;if(!("string"!=typeof e||Tt.test(e)||!b.support.htmlSerialize&&mt.test(e)||!b.support.leadingWhitespace&&yt.test(e)||At[(bt.exec(e)||["",""])[1].toLowerCase()])){e=e.replace(vt,"<$1></$2>");try{for(;i>r;r++)n=this[r]||{},1===n.nodeType&&(b.cleanData(Ot(n,!1)),n.innerHTML=e);n=0}catch(o){}}n&&this.empty().append(e)},null,e,arguments.length)},replaceWith:function(e){var t=b.isFunction(e);return t||"string"==typeof e||(e=b(e).not(this).detach()),this.domManip([e],!0,function(e){var t=this.nextSibling,n=this.parentNode;n&&(b(this).remove(),n.insertBefore(e,t))})},detach:function(e){return this.remove(e,!0)},domManip:function(e,n,r){e=f.apply([],e);var i,o,a,s,u,l,c=0,p=this.length,d=this,h=p-1,g=e[0],m=b.isFunction(g);if(m||!(1>=p||"string"!=typeof g||b.support.checkClone)&&Ct.test(g))return this.each(function(i){var o=d.eq(i);m&&(e[0]=g.call(this,i,n?o.html():t)),o.domManip(e,n,r)});if(p&&(l=b.buildFragment(e,this[0].ownerDocument,!1,this),i=l.firstChild,1===l.childNodes.length&&(l=i),i)){for(n=n&&b.nodeName(i,"tr"),s=b.map(Ot(l,"script"),Ht),a=s.length;p>c;c++)o=l,c!==h&&(o=b.clone(o,!0,!0),a&&b.merge(s,Ot(o,"script"))),r.call(n&&b.nodeName(this[c],"table")?Lt(this[c],"tbody"):this[c],o,c);if(a)for(u=s[s.length-1].ownerDocument,b.map(s,qt),c=0;a>c;c++)o=s[c],kt.test(o.type||"")&&!b._data(o,"globalEval")&&b.contains(u,o)&&(o.src?b.ajax({url:o.src,type:"GET",dataType:"script",async:!1,global:!1,"throws":!0}):b.globalEval((o.text||o.textContent||o.innerHTML||"").replace(St,"")));l=i=null}return this}});function Lt(e,t){return e.getElementsByTagName(t)[0]||e.appendChild(e.ownerDocument.createElement(t))}function Ht(e){var t=e.getAttributeNode("type");return e.type=(t&&t.specified)+"/"+e.type,e}function qt(e){var t=Et.exec(e.type);return t?e.type=t[1]:e.removeAttribute("type"),e}function Mt(e,t){var n,r=0;for(;null!=(n=e[r]);r++)b._data(n,"globalEval",!t||b._data(t[r],"globalEval"))}function _t(e,t){if(1===t.nodeType&&b.hasData(e)){var n,r,i,o=b._data(e),a=b._data(t,o),s=o.events;if(s){delete a.handle,a.events={};for(n in s)for(r=0,i=s[n].length;i>r;r++)b.event.add(t,n,s[n][r])}a.data&&(a.data=b.extend({},a.data))}}function Ft(e,t){var n,r,i;if(1===t.nodeType){if(n=t.nodeName.toLowerCase(),!b.support.noCloneEvent&&t[b.expando]){i=b._data(t);for(r in i.events)b.removeEvent(t,r,i.handle);t.removeAttribute(b.expando)}"script"===n&&t.text!==e.text?(Ht(t).text=e.text,qt(t)):"object"===n?(t.parentNode&&(t.outerHTML=e.outerHTML),b.support.html5Clone&&e.innerHTML&&!b.trim(t.innerHTML)&&(t.innerHTML=e.innerHTML)):"input"===n&&Nt.test(e.type)?(t.defaultChecked=t.checked=e.checked,t.value!==e.value&&(t.value=e.value)):"option"===n?t.defaultSelected=t.selected=e.defaultSelected:("input"===n||"textarea"===n)&&(t.defaultValue=e.defaultValue)}}b.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(e,t){b.fn[e]=function(e){var n,r=0,i=[],o=b(e),a=o.length-1;for(;a>=r;r++)n=r===a?this:this.clone(!0),b(o[r])[t](n),d.apply(i,n.get());return this.pushStack(i)}});function Ot(e,n){var r,o,a=0,s=typeof e.getElementsByTagName!==i?e.getElementsByTagName(n||"*"):typeof e.querySelectorAll!==i?e.querySelectorAll(n||"*"):t;if(!s)for(s=[],r=e.childNodes||e;null!=(o=r[a]);a++)!n||b.nodeName(o,n)?s.push(o):b.merge(s,Ot(o,n));return n===t||n&&b.nodeName(e,n)?b.merge([e],s):s}function Bt(e){Nt.test(e.type)&&(e.defaultChecked=e.checked)}b.extend({clone:function(e,t,n){var r,i,o,a,s,u=b.contains(e.ownerDocument,e);if(b.support.html5Clone||b.isXMLDoc(e)||!mt.test("<"+e.nodeName+">")?o=e.cloneNode(!0):(Dt.innerHTML=e.outerHTML,Dt.removeChild(o=Dt.firstChild)),!(b.support.noCloneEvent&&b.support.noCloneChecked||1!==e.nodeType&&11!==e.nodeType||b.isXMLDoc(e)))for(r=Ot(o),s=Ot(e),a=0;null!=(i=s[a]);++a)r[a]&&Ft(i,r[a]);if(t)if(n)for(s=s||Ot(e),r=r||Ot(o),a=0;null!=(i=s[a]);a++)_t(i,r[a]);else _t(e,o);return r=Ot(o,"script"),r.length>0&&Mt(r,!u&&Ot(e,"script")),r=s=i=null,o},buildFragment:function(e,t,n,r){var i,o,a,s,u,l,c,p=e.length,f=dt(t),d=[],h=0;for(;p>h;h++)if(o=e[h],o||0===o)if("object"===b.type(o))b.merge(d,o.nodeType?[o]:o);else if(wt.test(o)){s=s||f.appendChild(t.createElement("div")),u=(bt.exec(o)||["",""])[1].toLowerCase(),c=At[u]||At._default,s.innerHTML=c[1]+o.replace(vt,"<$1></$2>")+c[2],i=c[0];while(i--)s=s.lastChild;if(!b.support.leadingWhitespace&&yt.test(o)&&d.push(t.createTextNode(yt.exec(o)[0])),!b.support.tbody){o="table"!==u||xt.test(o)?"<table>"!==c[1]||xt.test(o)?0:s:s.firstChild,i=o&&o.childNodes.length;while(i--)b.nodeName(l=o.childNodes[i],"tbody")&&!l.childNodes.length&&o.removeChild(l)
}b.merge(d,s.childNodes),s.textContent="";while(s.firstChild)s.removeChild(s.firstChild);s=f.lastChild}else d.push(t.createTextNode(o));s&&f.removeChild(s),b.support.appendChecked||b.grep(Ot(d,"input"),Bt),h=0;while(o=d[h++])if((!r||-1===b.inArray(o,r))&&(a=b.contains(o.ownerDocument,o),s=Ot(f.appendChild(o),"script"),a&&Mt(s),n)){i=0;while(o=s[i++])kt.test(o.type||"")&&n.push(o)}return s=null,f},cleanData:function(e,t){var n,r,o,a,s=0,u=b.expando,l=b.cache,p=b.support.deleteExpando,f=b.event.special;for(;null!=(n=e[s]);s++)if((t||b.acceptData(n))&&(o=n[u],a=o&&l[o])){if(a.events)for(r in a.events)f[r]?b.event.remove(n,r):b.removeEvent(n,r,a.handle);l[o]&&(delete l[o],p?delete n[u]:typeof n.removeAttribute!==i?n.removeAttribute(u):n[u]=null,c.push(o))}}});var Pt,Rt,Wt,$t=/alpha\([^)]*\)/i,It=/opacity\s*=\s*([^)]*)/,zt=/^(top|right|bottom|left)$/,Xt=/^(none|table(?!-c[ea]).+)/,Ut=/^margin/,Vt=RegExp("^("+x+")(.*)$","i"),Yt=RegExp("^("+x+")(?!px)[a-z%]+$","i"),Jt=RegExp("^([+-])=("+x+")","i"),Gt={BODY:"block"},Qt={position:"absolute",visibility:"hidden",display:"block"},Kt={letterSpacing:0,fontWeight:400},Zt=["Top","Right","Bottom","Left"],en=["Webkit","O","Moz","ms"];function tn(e,t){if(t in e)return t;var n=t.charAt(0).toUpperCase()+t.slice(1),r=t,i=en.length;while(i--)if(t=en[i]+n,t in e)return t;return r}function nn(e,t){return e=t||e,"none"===b.css(e,"display")||!b.contains(e.ownerDocument,e)}function rn(e,t){var n,r,i,o=[],a=0,s=e.length;for(;s>a;a++)r=e[a],r.style&&(o[a]=b._data(r,"olddisplay"),n=r.style.display,t?(o[a]||"none"!==n||(r.style.display=""),""===r.style.display&&nn(r)&&(o[a]=b._data(r,"olddisplay",un(r.nodeName)))):o[a]||(i=nn(r),(n&&"none"!==n||!i)&&b._data(r,"olddisplay",i?n:b.css(r,"display"))));for(a=0;s>a;a++)r=e[a],r.style&&(t&&"none"!==r.style.display&&""!==r.style.display||(r.style.display=t?o[a]||"":"none"));return e}b.fn.extend({css:function(e,n){return b.access(this,function(e,n,r){var i,o,a={},s=0;if(b.isArray(n)){for(o=Rt(e),i=n.length;i>s;s++)a[n[s]]=b.css(e,n[s],!1,o);return a}return r!==t?b.style(e,n,r):b.css(e,n)},e,n,arguments.length>1)},show:function(){return rn(this,!0)},hide:function(){return rn(this)},toggle:function(e){var t="boolean"==typeof e;return this.each(function(){(t?e:nn(this))?b(this).show():b(this).hide()})}}),b.extend({cssHooks:{opacity:{get:function(e,t){if(t){var n=Wt(e,"opacity");return""===n?"1":n}}}},cssNumber:{columnCount:!0,fillOpacity:!0,fontWeight:!0,lineHeight:!0,opacity:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":b.support.cssFloat?"cssFloat":"styleFloat"},style:function(e,n,r,i){if(e&&3!==e.nodeType&&8!==e.nodeType&&e.style){var o,a,s,u=b.camelCase(n),l=e.style;if(n=b.cssProps[u]||(b.cssProps[u]=tn(l,u)),s=b.cssHooks[n]||b.cssHooks[u],r===t)return s&&"get"in s&&(o=s.get(e,!1,i))!==t?o:l[n];if(a=typeof r,"string"===a&&(o=Jt.exec(r))&&(r=(o[1]+1)*o[2]+parseFloat(b.css(e,n)),a="number"),!(null==r||"number"===a&&isNaN(r)||("number"!==a||b.cssNumber[u]||(r+="px"),b.support.clearCloneStyle||""!==r||0!==n.indexOf("background")||(l[n]="inherit"),s&&"set"in s&&(r=s.set(e,r,i))===t)))try{l[n]=r}catch(c){}}},css:function(e,n,r,i){var o,a,s,u=b.camelCase(n);return n=b.cssProps[u]||(b.cssProps[u]=tn(e.style,u)),s=b.cssHooks[n]||b.cssHooks[u],s&&"get"in s&&(a=s.get(e,!0,r)),a===t&&(a=Wt(e,n,i)),"normal"===a&&n in Kt&&(a=Kt[n]),""===r||r?(o=parseFloat(a),r===!0||b.isNumeric(o)?o||0:a):a},swap:function(e,t,n,r){var i,o,a={};for(o in t)a[o]=e.style[o],e.style[o]=t[o];i=n.apply(e,r||[]);for(o in t)e.style[o]=a[o];return i}}),e.getComputedStyle?(Rt=function(t){return e.getComputedStyle(t,null)},Wt=function(e,n,r){var i,o,a,s=r||Rt(e),u=s?s.getPropertyValue(n)||s[n]:t,l=e.style;return s&&(""!==u||b.contains(e.ownerDocument,e)||(u=b.style(e,n)),Yt.test(u)&&Ut.test(n)&&(i=l.width,o=l.minWidth,a=l.maxWidth,l.minWidth=l.maxWidth=l.width=u,u=s.width,l.width=i,l.minWidth=o,l.maxWidth=a)),u}):o.documentElement.currentStyle&&(Rt=function(e){return e.currentStyle},Wt=function(e,n,r){var i,o,a,s=r||Rt(e),u=s?s[n]:t,l=e.style;return null==u&&l&&l[n]&&(u=l[n]),Yt.test(u)&&!zt.test(n)&&(i=l.left,o=e.runtimeStyle,a=o&&o.left,a&&(o.left=e.currentStyle.left),l.left="fontSize"===n?"1em":u,u=l.pixelLeft+"px",l.left=i,a&&(o.left=a)),""===u?"auto":u});function on(e,t,n){var r=Vt.exec(t);return r?Math.max(0,r[1]-(n||0))+(r[2]||"px"):t}function an(e,t,n,r,i){var o=n===(r?"border":"content")?4:"width"===t?1:0,a=0;for(;4>o;o+=2)"margin"===n&&(a+=b.css(e,n+Zt[o],!0,i)),r?("content"===n&&(a-=b.css(e,"padding"+Zt[o],!0,i)),"margin"!==n&&(a-=b.css(e,"border"+Zt[o]+"Width",!0,i))):(a+=b.css(e,"padding"+Zt[o],!0,i),"padding"!==n&&(a+=b.css(e,"border"+Zt[o]+"Width",!0,i)));return a}function sn(e,t,n){var r=!0,i="width"===t?e.offsetWidth:e.offsetHeight,o=Rt(e),a=b.support.boxSizing&&"border-box"===b.css(e,"boxSizing",!1,o);if(0>=i||null==i){if(i=Wt(e,t,o),(0>i||null==i)&&(i=e.style[t]),Yt.test(i))return i;r=a&&(b.support.boxSizingReliable||i===e.style[t]),i=parseFloat(i)||0}return i+an(e,t,n||(a?"border":"content"),r,o)+"px"}function un(e){var t=o,n=Gt[e];return n||(n=ln(e,t),"none"!==n&&n||(Pt=(Pt||b("<iframe frameborder='0' width='0' height='0'/>").css("cssText","display:block !important")).appendTo(t.documentElement),t=(Pt[0].contentWindow||Pt[0].contentDocument).document,t.write("<!doctype html><html><body>"),t.close(),n=ln(e,t),Pt.detach()),Gt[e]=n),n}function ln(e,t){var n=b(t.createElement(e)).appendTo(t.body),r=b.css(n[0],"display");return n.remove(),r}b.each(["height","width"],function(e,n){b.cssHooks[n]={get:function(e,r,i){return r?0===e.offsetWidth&&Xt.test(b.css(e,"display"))?b.swap(e,Qt,function(){return sn(e,n,i)}):sn(e,n,i):t},set:function(e,t,r){var i=r&&Rt(e);return on(e,t,r?an(e,n,r,b.support.boxSizing&&"border-box"===b.css(e,"boxSizing",!1,i),i):0)}}}),b.support.opacity||(b.cssHooks.opacity={get:function(e,t){return It.test((t&&e.currentStyle?e.currentStyle.filter:e.style.filter)||"")?.01*parseFloat(RegExp.$1)+"":t?"1":""},set:function(e,t){var n=e.style,r=e.currentStyle,i=b.isNumeric(t)?"alpha(opacity="+100*t+")":"",o=r&&r.filter||n.filter||"";n.zoom=1,(t>=1||""===t)&&""===b.trim(o.replace($t,""))&&n.removeAttribute&&(n.removeAttribute("filter"),""===t||r&&!r.filter)||(n.filter=$t.test(o)?o.replace($t,i):o+" "+i)}}),b(function(){b.support.reliableMarginRight||(b.cssHooks.marginRight={get:function(e,n){return n?b.swap(e,{display:"inline-block"},Wt,[e,"marginRight"]):t}}),!b.support.pixelPosition&&b.fn.position&&b.each(["top","left"],function(e,n){b.cssHooks[n]={get:function(e,r){return r?(r=Wt(e,n),Yt.test(r)?b(e).position()[n]+"px":r):t}}})}),b.expr&&b.expr.filters&&(b.expr.filters.hidden=function(e){return 0>=e.offsetWidth&&0>=e.offsetHeight||!b.support.reliableHiddenOffsets&&"none"===(e.style&&e.style.display||b.css(e,"display"))},b.expr.filters.visible=function(e){return!b.expr.filters.hidden(e)}),b.each({margin:"",padding:"",border:"Width"},function(e,t){b.cssHooks[e+t]={expand:function(n){var r=0,i={},o="string"==typeof n?n.split(" "):[n];for(;4>r;r++)i[e+Zt[r]+t]=o[r]||o[r-2]||o[0];return i}},Ut.test(e)||(b.cssHooks[e+t].set=on)});var cn=/%20/g,pn=/\[\]$/,fn=/\r?\n/g,dn=/^(?:submit|button|image|reset|file)$/i,hn=/^(?:input|select|textarea|keygen)/i;b.fn.extend({serialize:function(){return b.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var e=b.prop(this,"elements");return e?b.makeArray(e):this}).filter(function(){var e=this.type;return this.name&&!b(this).is(":disabled")&&hn.test(this.nodeName)&&!dn.test(e)&&(this.checked||!Nt.test(e))}).map(function(e,t){var n=b(this).val();return null==n?null:b.isArray(n)?b.map(n,function(e){return{name:t.name,value:e.replace(fn,"\r\n")}}):{name:t.name,value:n.replace(fn,"\r\n")}}).get()}}),b.param=function(e,n){var r,i=[],o=function(e,t){t=b.isFunction(t)?t():null==t?"":t,i[i.length]=encodeURIComponent(e)+"="+encodeURIComponent(t)};if(n===t&&(n=b.ajaxSettings&&b.ajaxSettings.traditional),b.isArray(e)||e.jquery&&!b.isPlainObject(e))b.each(e,function(){o(this.name,this.value)});else for(r in e)gn(r,e[r],n,o);return i.join("&").replace(cn,"+")};function gn(e,t,n,r){var i;if(b.isArray(t))b.each(t,function(t,i){n||pn.test(e)?r(e,i):gn(e+"["+("object"==typeof i?t:"")+"]",i,n,r)});else if(n||"object"!==b.type(t))r(e,t);else for(i in t)gn(e+"["+i+"]",t[i],n,r)}b.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(e,t){b.fn[t]=function(e,n){return arguments.length>0?this.on(t,null,e,n):this.trigger(t)}}),b.fn.hover=function(e,t){return this.mouseenter(e).mouseleave(t||e)};var mn,yn,vn=b.now(),bn=/\?/,xn=/#.*$/,wn=/([?&])_=[^&]*/,Tn=/^(.*?):[ \t]*([^\r\n]*)\r?$/gm,Nn=/^(?:about|app|app-storage|.+-extension|file|res|widget):$/,Cn=/^(?:GET|HEAD)$/,kn=/^\/\//,En=/^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,Sn=b.fn.load,An={},jn={},Dn="*/".concat("*");try{yn=a.href}catch(Ln){yn=o.createElement("a"),yn.href="",yn=yn.href}mn=En.exec(yn.toLowerCase())||[];function Hn(e){return function(t,n){"string"!=typeof t&&(n=t,t="*");var r,i=0,o=t.toLowerCase().match(w)||[];if(b.isFunction(n))while(r=o[i++])"+"===r[0]?(r=r.slice(1)||"*",(e[r]=e[r]||[]).unshift(n)):(e[r]=e[r]||[]).push(n)}}function qn(e,n,r,i){var o={},a=e===jn;function s(u){var l;return o[u]=!0,b.each(e[u]||[],function(e,u){var c=u(n,r,i);return"string"!=typeof c||a||o[c]?a?!(l=c):t:(n.dataTypes.unshift(c),s(c),!1)}),l}return s(n.dataTypes[0])||!o["*"]&&s("*")}function Mn(e,n){var r,i,o=b.ajaxSettings.flatOptions||{};for(i in n)n[i]!==t&&((o[i]?e:r||(r={}))[i]=n[i]);return r&&b.extend(!0,e,r),e}b.fn.load=function(e,n,r){if("string"!=typeof e&&Sn)return Sn.apply(this,arguments);var i,o,a,s=this,u=e.indexOf(" ");return u>=0&&(i=e.slice(u,e.length),e=e.slice(0,u)),b.isFunction(n)?(r=n,n=t):n&&"object"==typeof n&&(a="POST"),s.length>0&&b.ajax({url:e,type:a,dataType:"html",data:n}).done(function(e){o=arguments,s.html(i?b("<div>").append(b.parseHTML(e)).find(i):e)}).complete(r&&function(e,t){s.each(r,o||[e.responseText,t,e])}),this},b.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(e,t){b.fn[t]=function(e){return this.on(t,e)}}),b.each(["get","post"],function(e,n){b[n]=function(e,r,i,o){return b.isFunction(r)&&(o=o||i,i=r,r=t),b.ajax({url:e,type:n,dataType:o,data:r,success:i})}}),b.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:yn,type:"GET",isLocal:Nn.test(mn[1]),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":Dn,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":e.String,"text html":!0,"text json":b.parseJSON,"text xml":b.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(e,t){return t?Mn(Mn(e,b.ajaxSettings),t):Mn(b.ajaxSettings,e)},ajaxPrefilter:Hn(An),ajaxTransport:Hn(jn),ajax:function(e,n){"object"==typeof e&&(n=e,e=t),n=n||{};var r,i,o,a,s,u,l,c,p=b.ajaxSetup({},n),f=p.context||p,d=p.context&&(f.nodeType||f.jquery)?b(f):b.event,h=b.Deferred(),g=b.Callbacks("once memory"),m=p.statusCode||{},y={},v={},x=0,T="canceled",N={readyState:0,getResponseHeader:function(e){var t;if(2===x){if(!c){c={};while(t=Tn.exec(a))c[t[1].toLowerCase()]=t[2]}t=c[e.toLowerCase()]}return null==t?null:t},getAllResponseHeaders:function(){return 2===x?a:null},setRequestHeader:function(e,t){var n=e.toLowerCase();return x||(e=v[n]=v[n]||e,y[e]=t),this},overrideMimeType:function(e){return x||(p.mimeType=e),this},statusCode:function(e){var t;if(e)if(2>x)for(t in e)m[t]=[m[t],e[t]];else N.always(e[N.status]);return this},abort:function(e){var t=e||T;return l&&l.abort(t),k(0,t),this}};if(h.promise(N).complete=g.add,N.success=N.done,N.error=N.fail,p.url=((e||p.url||yn)+"").replace(xn,"").replace(kn,mn[1]+"//"),p.type=n.method||n.type||p.method||p.type,p.dataTypes=b.trim(p.dataType||"*").toLowerCase().match(w)||[""],null==p.crossDomain&&(r=En.exec(p.url.toLowerCase()),p.crossDomain=!(!r||r[1]===mn[1]&&r[2]===mn[2]&&(r[3]||("http:"===r[1]?80:443))==(mn[3]||("http:"===mn[1]?80:443)))),p.data&&p.processData&&"string"!=typeof p.data&&(p.data=b.param(p.data,p.traditional)),qn(An,p,n,N),2===x)return N;u=p.global,u&&0===b.active++&&b.event.trigger("ajaxStart"),p.type=p.type.toUpperCase(),p.hasContent=!Cn.test(p.type),o=p.url,p.hasContent||(p.data&&(o=p.url+=(bn.test(o)?"&":"?")+p.data,delete p.data),p.cache===!1&&(p.url=wn.test(o)?o.replace(wn,"$1_="+vn++):o+(bn.test(o)?"&":"?")+"_="+vn++)),p.ifModified&&(b.lastModified[o]&&N.setRequestHeader("If-Modified-Since",b.lastModified[o]),b.etag[o]&&N.setRequestHeader("If-None-Match",b.etag[o])),(p.data&&p.hasContent&&p.contentType!==!1||n.contentType)&&N.setRequestHeader("Content-Type",p.contentType),N.setRequestHeader("Accept",p.dataTypes[0]&&p.accepts[p.dataTypes[0]]?p.accepts[p.dataTypes[0]]+("*"!==p.dataTypes[0]?", "+Dn+"; q=0.01":""):p.accepts["*"]);for(i in p.headers)N.setRequestHeader(i,p.headers[i]);if(p.beforeSend&&(p.beforeSend.call(f,N,p)===!1||2===x))return N.abort();T="abort";for(i in{success:1,error:1,complete:1})N[i](p[i]);if(l=qn(jn,p,n,N)){N.readyState=1,u&&d.trigger("ajaxSend",[N,p]),p.async&&p.timeout>0&&(s=setTimeout(function(){N.abort("timeout")},p.timeout));try{x=1,l.send(y,k)}catch(C){if(!(2>x))throw C;k(-1,C)}}else k(-1,"No Transport");function k(e,n,r,i){var c,y,v,w,T,C=n;2!==x&&(x=2,s&&clearTimeout(s),l=t,a=i||"",N.readyState=e>0?4:0,r&&(w=_n(p,N,r)),e>=200&&300>e||304===e?(p.ifModified&&(T=N.getResponseHeader("Last-Modified"),T&&(b.lastModified[o]=T),T=N.getResponseHeader("etag"),T&&(b.etag[o]=T)),204===e?(c=!0,C="nocontent"):304===e?(c=!0,C="notmodified"):(c=Fn(p,w),C=c.state,y=c.data,v=c.error,c=!v)):(v=C,(e||!C)&&(C="error",0>e&&(e=0))),N.status=e,N.statusText=(n||C)+"",c?h.resolveWith(f,[y,C,N]):h.rejectWith(f,[N,C,v]),N.statusCode(m),m=t,u&&d.trigger(c?"ajaxSuccess":"ajaxError",[N,p,c?y:v]),g.fireWith(f,[N,C]),u&&(d.trigger("ajaxComplete",[N,p]),--b.active||b.event.trigger("ajaxStop")))}return N},getScript:function(e,n){return b.get(e,t,n,"script")},getJSON:function(e,t,n){return b.get(e,t,n,"json")}});function _n(e,n,r){var i,o,a,s,u=e.contents,l=e.dataTypes,c=e.responseFields;for(s in c)s in r&&(n[c[s]]=r[s]);while("*"===l[0])l.shift(),o===t&&(o=e.mimeType||n.getResponseHeader("Content-Type"));if(o)for(s in u)if(u[s]&&u[s].test(o)){l.unshift(s);break}if(l[0]in r)a=l[0];else{for(s in r){if(!l[0]||e.converters[s+" "+l[0]]){a=s;break}i||(i=s)}a=a||i}return a?(a!==l[0]&&l.unshift(a),r[a]):t}function Fn(e,t){var n,r,i,o,a={},s=0,u=e.dataTypes.slice(),l=u[0];if(e.dataFilter&&(t=e.dataFilter(t,e.dataType)),u[1])for(i in e.converters)a[i.toLowerCase()]=e.converters[i];for(;r=u[++s];)if("*"!==r){if("*"!==l&&l!==r){if(i=a[l+" "+r]||a["* "+r],!i)for(n in a)if(o=n.split(" "),o[1]===r&&(i=a[l+" "+o[0]]||a["* "+o[0]])){i===!0?i=a[n]:a[n]!==!0&&(r=o[0],u.splice(s--,0,r));break}if(i!==!0)if(i&&e["throws"])t=i(t);else try{t=i(t)}catch(c){return{state:"parsererror",error:i?c:"No conversion from "+l+" to "+r}}}l=r}return{state:"success",data:t}}b.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/(?:java|ecma)script/},converters:{"text script":function(e){return b.globalEval(e),e}}}),b.ajaxPrefilter("script",function(e){e.cache===t&&(e.cache=!1),e.crossDomain&&(e.type="GET",e.global=!1)}),b.ajaxTransport("script",function(e){if(e.crossDomain){var n,r=o.head||b("head")[0]||o.documentElement;return{send:function(t,i){n=o.createElement("script"),n.async=!0,e.scriptCharset&&(n.charset=e.scriptCharset),n.src=e.url,n.onload=n.onreadystatechange=function(e,t){(t||!n.readyState||/loaded|complete/.test(n.readyState))&&(n.onload=n.onreadystatechange=null,n.parentNode&&n.parentNode.removeChild(n),n=null,t||i(200,"success"))},r.insertBefore(n,r.firstChild)},abort:function(){n&&n.onload(t,!0)}}}});var On=[],Bn=/(=)\?(?=&|$)|\?\?/;b.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var e=On.pop()||b.expando+"_"+vn++;return this[e]=!0,e}}),b.ajaxPrefilter("json jsonp",function(n,r,i){var o,a,s,u=n.jsonp!==!1&&(Bn.test(n.url)?"url":"string"==typeof n.data&&!(n.contentType||"").indexOf("application/x-www-form-urlencoded")&&Bn.test(n.data)&&"data");return u||"jsonp"===n.dataTypes[0]?(o=n.jsonpCallback=b.isFunction(n.jsonpCallback)?n.jsonpCallback():n.jsonpCallback,u?n[u]=n[u].replace(Bn,"$1"+o):n.jsonp!==!1&&(n.url+=(bn.test(n.url)?"&":"?")+n.jsonp+"="+o),n.converters["script json"]=function(){return s||b.error(o+" was not called"),s[0]},n.dataTypes[0]="json",a=e[o],e[o]=function(){s=arguments},i.always(function(){e[o]=a,n[o]&&(n.jsonpCallback=r.jsonpCallback,On.push(o)),s&&b.isFunction(a)&&a(s[0]),s=a=t}),"script"):t});var Pn,Rn,Wn=0,$n=e.ActiveXObject&&function(){var e;for(e in Pn)Pn[e](t,!0)};function In(){try{return new e.XMLHttpRequest}catch(t){}}function zn(){try{return new e.ActiveXObject("Microsoft.XMLHTTP")}catch(t){}}b.ajaxSettings.xhr=e.ActiveXObject?function(){return!this.isLocal&&In()||zn()}:In,Rn=b.ajaxSettings.xhr(),b.support.cors=!!Rn&&"withCredentials"in Rn,Rn=b.support.ajax=!!Rn,Rn&&b.ajaxTransport(function(n){if(!n.crossDomain||b.support.cors){var r;return{send:function(i,o){var a,s,u=n.xhr();if(n.username?u.open(n.type,n.url,n.async,n.username,n.password):u.open(n.type,n.url,n.async),n.xhrFields)for(s in n.xhrFields)u[s]=n.xhrFields[s];n.mimeType&&u.overrideMimeType&&u.overrideMimeType(n.mimeType),n.crossDomain||i["X-Requested-With"]||(i["X-Requested-With"]="XMLHttpRequest");try{for(s in i)u.setRequestHeader(s,i[s])}catch(l){}u.send(n.hasContent&&n.data||null),r=function(e,i){var s,l,c,p;try{if(r&&(i||4===u.readyState))if(r=t,a&&(u.onreadystatechange=b.noop,$n&&delete Pn[a]),i)4!==u.readyState&&u.abort();else{p={},s=u.status,l=u.getAllResponseHeaders(),"string"==typeof u.responseText&&(p.text=u.responseText);try{c=u.statusText}catch(f){c=""}s||!n.isLocal||n.crossDomain?1223===s&&(s=204):s=p.text?200:404}}catch(d){i||o(-1,d)}p&&o(s,c,p,l)},n.async?4===u.readyState?setTimeout(r):(a=++Wn,$n&&(Pn||(Pn={},b(e).unload($n)),Pn[a]=r),u.onreadystatechange=r):r()},abort:function(){r&&r(t,!0)}}}});var Xn,Un,Vn=/^(?:toggle|show|hide)$/,Yn=RegExp("^(?:([+-])=|)("+x+")([a-z%]*)$","i"),Jn=/queueHooks$/,Gn=[nr],Qn={"*":[function(e,t){var n,r,i=this.createTween(e,t),o=Yn.exec(t),a=i.cur(),s=+a||0,u=1,l=20;if(o){if(n=+o[2],r=o[3]||(b.cssNumber[e]?"":"px"),"px"!==r&&s){s=b.css(i.elem,e,!0)||n||1;do u=u||".5",s/=u,b.style(i.elem,e,s+r);while(u!==(u=i.cur()/a)&&1!==u&&--l)}i.unit=r,i.start=s,i.end=o[1]?s+(o[1]+1)*n:n}return i}]};function Kn(){return setTimeout(function(){Xn=t}),Xn=b.now()}function Zn(e,t){b.each(t,function(t,n){var r=(Qn[t]||[]).concat(Qn["*"]),i=0,o=r.length;for(;o>i;i++)if(r[i].call(e,t,n))return})}function er(e,t,n){var r,i,o=0,a=Gn.length,s=b.Deferred().always(function(){delete u.elem}),u=function(){if(i)return!1;var t=Xn||Kn(),n=Math.max(0,l.startTime+l.duration-t),r=n/l.duration||0,o=1-r,a=0,u=l.tweens.length;for(;u>a;a++)l.tweens[a].run(o);return s.notifyWith(e,[l,o,n]),1>o&&u?n:(s.resolveWith(e,[l]),!1)},l=s.promise({elem:e,props:b.extend({},t),opts:b.extend(!0,{specialEasing:{}},n),originalProperties:t,originalOptions:n,startTime:Xn||Kn(),duration:n.duration,tweens:[],createTween:function(t,n){var r=b.Tween(e,l.opts,t,n,l.opts.specialEasing[t]||l.opts.easing);return l.tweens.push(r),r},stop:function(t){var n=0,r=t?l.tweens.length:0;if(i)return this;for(i=!0;r>n;n++)l.tweens[n].run(1);return t?s.resolveWith(e,[l,t]):s.rejectWith(e,[l,t]),this}}),c=l.props;for(tr(c,l.opts.specialEasing);a>o;o++)if(r=Gn[o].call(l,e,c,l.opts))return r;return Zn(l,c),b.isFunction(l.opts.start)&&l.opts.start.call(e,l),b.fx.timer(b.extend(u,{elem:e,anim:l,queue:l.opts.queue})),l.progress(l.opts.progress).done(l.opts.done,l.opts.complete).fail(l.opts.fail).always(l.opts.always)}function tr(e,t){var n,r,i,o,a;for(i in e)if(r=b.camelCase(i),o=t[r],n=e[i],b.isArray(n)&&(o=n[1],n=e[i]=n[0]),i!==r&&(e[r]=n,delete e[i]),a=b.cssHooks[r],a&&"expand"in a){n=a.expand(n),delete e[r];for(i in n)i in e||(e[i]=n[i],t[i]=o)}else t[r]=o}b.Animation=b.extend(er,{tweener:function(e,t){b.isFunction(e)?(t=e,e=["*"]):e=e.split(" ");var n,r=0,i=e.length;for(;i>r;r++)n=e[r],Qn[n]=Qn[n]||[],Qn[n].unshift(t)},prefilter:function(e,t){t?Gn.unshift(e):Gn.push(e)}});function nr(e,t,n){var r,i,o,a,s,u,l,c,p,f=this,d=e.style,h={},g=[],m=e.nodeType&&nn(e);n.queue||(c=b._queueHooks(e,"fx"),null==c.unqueued&&(c.unqueued=0,p=c.empty.fire,c.empty.fire=function(){c.unqueued||p()}),c.unqueued++,f.always(function(){f.always(function(){c.unqueued--,b.queue(e,"fx").length||c.empty.fire()})})),1===e.nodeType&&("height"in t||"width"in t)&&(n.overflow=[d.overflow,d.overflowX,d.overflowY],"inline"===b.css(e,"display")&&"none"===b.css(e,"float")&&(b.support.inlineBlockNeedsLayout&&"inline"!==un(e.nodeName)?d.zoom=1:d.display="inline-block")),n.overflow&&(d.overflow="hidden",b.support.shrinkWrapBlocks||f.always(function(){d.overflow=n.overflow[0],d.overflowX=n.overflow[1],d.overflowY=n.overflow[2]}));for(i in t)if(a=t[i],Vn.exec(a)){if(delete t[i],u=u||"toggle"===a,a===(m?"hide":"show"))continue;g.push(i)}if(o=g.length){s=b._data(e,"fxshow")||b._data(e,"fxshow",{}),"hidden"in s&&(m=s.hidden),u&&(s.hidden=!m),m?b(e).show():f.done(function(){b(e).hide()}),f.done(function(){var t;b._removeData(e,"fxshow");for(t in h)b.style(e,t,h[t])});for(i=0;o>i;i++)r=g[i],l=f.createTween(r,m?s[r]:0),h[r]=s[r]||b.style(e,r),r in s||(s[r]=l.start,m&&(l.end=l.start,l.start="width"===r||"height"===r?1:0))}}function rr(e,t,n,r,i){return new rr.prototype.init(e,t,n,r,i)}b.Tween=rr,rr.prototype={constructor:rr,init:function(e,t,n,r,i,o){this.elem=e,this.prop=n,this.easing=i||"swing",this.options=t,this.start=this.now=this.cur(),this.end=r,this.unit=o||(b.cssNumber[n]?"":"px")},cur:function(){var e=rr.propHooks[this.prop];return e&&e.get?e.get(this):rr.propHooks._default.get(this)},run:function(e){var t,n=rr.propHooks[this.prop];return this.pos=t=this.options.duration?b.easing[this.easing](e,this.options.duration*e,0,1,this.options.duration):e,this.now=(this.end-this.start)*t+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),n&&n.set?n.set(this):rr.propHooks._default.set(this),this}},rr.prototype.init.prototype=rr.prototype,rr.propHooks={_default:{get:function(e){var t;return null==e.elem[e.prop]||e.elem.style&&null!=e.elem.style[e.prop]?(t=b.css(e.elem,e.prop,""),t&&"auto"!==t?t:0):e.elem[e.prop]},set:function(e){b.fx.step[e.prop]?b.fx.step[e.prop](e):e.elem.style&&(null!=e.elem.style[b.cssProps[e.prop]]||b.cssHooks[e.prop])?b.style(e.elem,e.prop,e.now+e.unit):e.elem[e.prop]=e.now}}},rr.propHooks.scrollTop=rr.propHooks.scrollLeft={set:function(e){e.elem.nodeType&&e.elem.parentNode&&(e.elem[e.prop]=e.now)}},b.each(["toggle","show","hide"],function(e,t){var n=b.fn[t];b.fn[t]=function(e,r,i){return null==e||"boolean"==typeof e?n.apply(this,arguments):this.animate(ir(t,!0),e,r,i)}}),b.fn.extend({fadeTo:function(e,t,n,r){return this.filter(nn).css("opacity",0).show().end().animate({opacity:t},e,n,r)},animate:function(e,t,n,r){var i=b.isEmptyObject(e),o=b.speed(t,n,r),a=function(){var t=er(this,b.extend({},e),o);a.finish=function(){t.stop(!0)},(i||b._data(this,"finish"))&&t.stop(!0)};return a.finish=a,i||o.queue===!1?this.each(a):this.queue(o.queue,a)},stop:function(e,n,r){var i=function(e){var t=e.stop;delete e.stop,t(r)};return"string"!=typeof e&&(r=n,n=e,e=t),n&&e!==!1&&this.queue(e||"fx",[]),this.each(function(){var t=!0,n=null!=e&&e+"queueHooks",o=b.timers,a=b._data(this);if(n)a[n]&&a[n].stop&&i(a[n]);else for(n in a)a[n]&&a[n].stop&&Jn.test(n)&&i(a[n]);for(n=o.length;n--;)o[n].elem!==this||null!=e&&o[n].queue!==e||(o[n].anim.stop(r),t=!1,o.splice(n,1));(t||!r)&&b.dequeue(this,e)})},finish:function(e){return e!==!1&&(e=e||"fx"),this.each(function(){var t,n=b._data(this),r=n[e+"queue"],i=n[e+"queueHooks"],o=b.timers,a=r?r.length:0;for(n.finish=!0,b.queue(this,e,[]),i&&i.cur&&i.cur.finish&&i.cur.finish.call(this),t=o.length;t--;)o[t].elem===this&&o[t].queue===e&&(o[t].anim.stop(!0),o.splice(t,1));for(t=0;a>t;t++)r[t]&&r[t].finish&&r[t].finish.call(this);delete n.finish})}});function ir(e,t){var n,r={height:e},i=0;for(t=t?1:0;4>i;i+=2-t)n=Zt[i],r["margin"+n]=r["padding"+n]=e;return t&&(r.opacity=r.width=e),r}b.each({slideDown:ir("show"),slideUp:ir("hide"),slideToggle:ir("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(e,t){b.fn[e]=function(e,n,r){return this.animate(t,e,n,r)}}),b.speed=function(e,t,n){var r=e&&"object"==typeof e?b.extend({},e):{complete:n||!n&&t||b.isFunction(e)&&e,duration:e,easing:n&&t||t&&!b.isFunction(t)&&t};return r.duration=b.fx.off?0:"number"==typeof r.duration?r.duration:r.duration in b.fx.speeds?b.fx.speeds[r.duration]:b.fx.speeds._default,(null==r.queue||r.queue===!0)&&(r.queue="fx"),r.old=r.complete,r.complete=function(){b.isFunction(r.old)&&r.old.call(this),r.queue&&b.dequeue(this,r.queue)},r},b.easing={linear:function(e){return e},swing:function(e){return.5-Math.cos(e*Math.PI)/2}},b.timers=[],b.fx=rr.prototype.init,b.fx.tick=function(){var e,n=b.timers,r=0;for(Xn=b.now();n.length>r;r++)e=n[r],e()||n[r]!==e||n.splice(r--,1);n.length||b.fx.stop(),Xn=t},b.fx.timer=function(e){e()&&b.timers.push(e)&&b.fx.start()},b.fx.interval=13,b.fx.start=function(){Un||(Un=setInterval(b.fx.tick,b.fx.interval))},b.fx.stop=function(){clearInterval(Un),Un=null},b.fx.speeds={slow:600,fast:200,_default:400},b.fx.step={},b.expr&&b.expr.filters&&(b.expr.filters.animated=function(e){return b.grep(b.timers,function(t){return e===t.elem}).length}),b.fn.offset=function(e){if(arguments.length)return e===t?this:this.each(function(t){b.offset.setOffset(this,e,t)});var n,r,o={top:0,left:0},a=this[0],s=a&&a.ownerDocument;if(s)return n=s.documentElement,b.contains(n,a)?(typeof a.getBoundingClientRect!==i&&(o=a.getBoundingClientRect()),r=or(s),{top:o.top+(r.pageYOffset||n.scrollTop)-(n.clientTop||0),left:o.left+(r.pageXOffset||n.scrollLeft)-(n.clientLeft||0)}):o},b.offset={setOffset:function(e,t,n){var r=b.css(e,"position");"static"===r&&(e.style.position="relative");var i=b(e),o=i.offset(),a=b.css(e,"top"),s=b.css(e,"left"),u=("absolute"===r||"fixed"===r)&&b.inArray("auto",[a,s])>-1,l={},c={},p,f;u?(c=i.position(),p=c.top,f=c.left):(p=parseFloat(a)||0,f=parseFloat(s)||0),b.isFunction(t)&&(t=t.call(e,n,o)),null!=t.top&&(l.top=t.top-o.top+p),null!=t.left&&(l.left=t.left-o.left+f),"using"in t?t.using.call(e,l):i.css(l)}},b.fn.extend({position:function(){if(this[0]){var e,t,n={top:0,left:0},r=this[0];return"fixed"===b.css(r,"position")?t=r.getBoundingClientRect():(e=this.offsetParent(),t=this.offset(),b.nodeName(e[0],"html")||(n=e.offset()),n.top+=b.css(e[0],"borderTopWidth",!0),n.left+=b.css(e[0],"borderLeftWidth",!0)),{top:t.top-n.top-b.css(r,"marginTop",!0),left:t.left-n.left-b.css(r,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var e=this.offsetParent||o.documentElement;while(e&&!b.nodeName(e,"html")&&"static"===b.css(e,"position"))e=e.offsetParent;return e||o.documentElement})}}),b.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(e,n){var r=/Y/.test(n);b.fn[e]=function(i){return b.access(this,function(e,i,o){var a=or(e);return o===t?a?n in a?a[n]:a.document.documentElement[i]:e[i]:(a?a.scrollTo(r?b(a).scrollLeft():o,r?o:b(a).scrollTop()):e[i]=o,t)},e,i,arguments.length,null)}});function or(e){return b.isWindow(e)?e:9===e.nodeType?e.defaultView||e.parentWindow:!1}b.each({Height:"height",Width:"width"},function(e,n){b.each({padding:"inner"+e,content:n,"":"outer"+e},function(r,i){b.fn[i]=function(i,o){var a=arguments.length&&(r||"boolean"!=typeof i),s=r||(i===!0||o===!0?"margin":"border");return b.access(this,function(n,r,i){var o;return b.isWindow(n)?n.document.documentElement["client"+e]:9===n.nodeType?(o=n.documentElement,Math.max(n.body["scroll"+e],o["scroll"+e],n.body["offset"+e],o["offset"+e],o["client"+e])):i===t?b.css(n,r,s):b.style(n,r,i,s)},n,a?i:t,a,null)}})}),e.jQuery=e.$=b,"function"==typeof define&&define.amd&&define.amd.jQuery&&define("jquery",[],function(){return b})})(window);
//     Underscore.js 1.6.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.6.0';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return obj;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, length = obj.length; i < length; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      var keys = _.keys(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        if (iterator.call(context, obj[keys[i]], keys[i], obj) === breaker) return;
      }
    }
    return obj;
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results.push(iterator.call(context, value, index, list));
    });
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    any(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(predicate, context);
    each(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, function(value, index, list) {
      return !predicate.call(context, value, index, list);
    }, context);
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(predicate, context);
    each(obj, function(value, index, list) {
      if (!(result = result && predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(predicate, context);
    each(obj, function(value, index, list) {
      if (result || (result = predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    return any(obj, function(value) {
      return value === target;
    });
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    var result = -Infinity, lastComputed = -Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed > lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    var result = Infinity, lastComputed = Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed < lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Shuffle an array, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return value;
    return _.property(value);
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, iterator, context) {
    iterator = lookupIterator(iterator);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iterator, context) {
      var result = {};
      iterator = lookupIterator(iterator);
      each(obj, function(value, index) {
        var key = iterator.call(context, value, index, obj);
        behavior(result, key, value);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, key, value) {
    _.has(result, key) ? result[key].push(value) : result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, key, value) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, key) {
    _.has(result, key) ? result[key]++ : result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    each(input, function(value) {
      if (_.isArray(value) || _.isArguments(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Split an array into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(array, predicate) {
    var pass = [], fail = [];
    each(array, function(elem) {
      (predicate(elem) ? pass : fail).push(elem);
    });
    return [pass, fail];
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    if (_.isFunction(isSorted)) {
      context = iterator;
      iterator = isSorted;
      isSorted = false;
    }
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.contains(other, item);
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var length = _.max(_.pluck(arguments, 'length').concat(0));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, '' + i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, length + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(length);

    while(idx < length) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length === 0) throw new Error('bindAll must be passed function names');
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    options || (options = {});
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;
      if (last < wait) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = new Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = new Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          if (obj[prop] === void 0) obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
                             _.isFunction(bCtor) && (bCtor instanceof bCtor))
                        && ('constructor' in a && 'constructor' in b)) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function () {
      return value;
    };
  };

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    return function(obj) {
      if (obj === attrs) return true; //avoid comparing an object to itself.
      for (var key in attrs) {
        if (attrs[key] !== obj[key])
          return false;
      }
      return true;
    }
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    var accum = Array(Math.max(0, n));
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() { return new Date().getTime(); };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    var render;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}).call(this);

//     Backbone.js 1.1.2

//     (c) 2010-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

(function(root, factory) {

  // Set up Backbone appropriately for the environment. Start with AMD.
  if (typeof define === 'function' && define.amd) {
    define('Backbone',['underscore', 'jquery', 'exports'], function(_, $, exports) {
      // Export global even in AMD case in case this script is loaded with
      // others that may still expect a global Backbone.
      root.Backbone = factory(root, exports, _, $);
    });

  // Next for Node.js or CommonJS. jQuery may not be needed as a module.
  } else if (typeof exports !== 'undefined') {
    var _ = require('underscore');
    factory(root, exports, _);

  // Finally, as a browser global.
  } else {
    root.Backbone = factory(root, {}, root._, (root.jQuery || root.Zepto || root.ender || root.$));
  }

}(this, function(root, Backbone, _, $) {

  // Initial Setup
  // -------------

  // Save the previous value of the `Backbone` variable, so that it can be
  // restored later on, if `noConflict` is used.
  var previousBackbone = root.Backbone;

  // Create local references to array methods we'll want to use later.
  var array = [];
  var push = array.push;
  var slice = array.slice;
  var splice = array.splice;

  // Current version of the library. Keep in sync with `package.json`.
  Backbone.VERSION = '1.1.2';

  // For Backbone's purposes, jQuery, Zepto, Ender, or My Library (kidding) owns
  // the `$` variable.
  Backbone.$ = $;

  // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
  // to its previous owner. Returns a reference to this Backbone object.
  Backbone.noConflict = function() {
    root.Backbone = previousBackbone;
    return this;
  };

  // Turn on `emulateHTTP` to support legacy HTTP servers. Setting this option
  // will fake `"PATCH"`, `"PUT"` and `"DELETE"` requests via the `_method` parameter and
  // set a `X-Http-Method-Override` header.
  Backbone.emulateHTTP = false;

  // Turn on `emulateJSON` to support legacy servers that can't deal with direct
  // `application/json` requests ... will encode the body as
  // `application/x-www-form-urlencoded` instead and will send the model in a
  // form param named `model`.
  Backbone.emulateJSON = false;

  // Backbone.Events
  // ---------------

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Backbone.Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = void 0;
        return this;
      }
      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeningTo = this._listeningTo;
      if (!listeningTo) return this;
      var remove = !name && !callback;
      if (!callback && typeof name === 'object') callback = this;
      if (obj) (listeningTo = {})[obj._listenId] = obj;
      for (var id in listeningTo) {
        obj = listeningTo[id];
        obj.off(name, callback, this);
        if (remove || _.isEmpty(obj._events)) delete this._listeningTo[id];
      }
      return this;
    }

  };

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args); return;
    }
  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeningTo = this._listeningTo || (this._listeningTo = {});
      var id = obj._listenId || (obj._listenId = _.uniqueId('l'));
      listeningTo[id] = obj;
      if (!callback && typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Allow the `Backbone` object to serve as a global event bus, for folks who
  // want global "pubsub" in a convenient place.
  _.extend(Backbone, Events);

  // Backbone.Model
  // --------------

  // Backbone **Models** are the basic data object in the framework --
  // frequently representing a row in a table in a database on your server.
  // A discrete chunk of data and a bunch of useful, related methods for
  // performing computations and transformations on that data.

  // Create a new model with the specified attributes. A client id (`cid`)
  // is automatically generated and assigned for you.
  var Model = Backbone.Model = function(attributes, options) {
    var attrs = attributes || {};
    options || (options = {});
    this.cid = _.uniqueId('c');
    this.attributes = {};
    if (options.collection) this.collection = options.collection;
    if (options.parse) attrs = this.parse(attrs, options) || {};
    attrs = _.defaults({}, attrs, _.result(this, 'defaults'));
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The value returned during the last failed validation.
    validationError: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default -- but override this if you need
    // custom syncing semantics for *this* particular model.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // Set a hash of model attributes on the object, firing `"change"`. This is
    // the core primitive operation of a model, updating the data and notifying
    // anyone who needs to know about the change in state. The heart of the beast.
    set: function(key, val, options) {
      var attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = options;
        for (var i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      // You might be wondering why there's a `while` loop here. Changes can
      // be recursively nested within `"change"` events.
      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          options = this._pending;
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"`. `unset` is a noop
    // if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"`.
    clear: function(options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var val, changed = false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      for (var attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overridden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      var attrs, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options = _.extend({validate: true}, options);

      // If we're not waiting and attributes exist, save acts as
      // `set(attr).save(null, opts)` with validation. Otherwise, check if
      // the model will be valid when the attributes, if any, are set.
      if (attrs && !options.wait) {
        if (!this.set(attrs, options)) return false;
      } else {
        if (!this._validate(attrs, options)) return false;
      }

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        var serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;

      var destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(resp) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      if (this.isNew()) {
        options.success();
        return false;
      }
      wrapError(this, options);

      var xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      var base =
        _.result(this, 'urlRoot') ||
        _.result(this.collection, 'url') ||
        urlError();
      if (this.isNew()) return base;
      return base.replace(/([^\/])$/, '$1/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return !this.has(this.idAttribute);
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return this._validate({}, _.extend(options || {}, { validate: true }));
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
      return false;
    }

  });

  // Underscore methods that we want to implement on the Model.
  var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

  // Mix in each Underscore method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.attributes);
      return _[method].apply(_, args);
    };
  });

  // Backbone.Collection
  // -------------------

  // If models tend to represent a single row of data, a Backbone Collection is
  // more analagous to a table full of data ... or a small slice or page of that
  // table, or a collection of rows that belong together for a particular reason
  // -- all of the messages in this particular folder, all of the documents
  // belonging to this particular author, and so on. Collections maintain
  // indexes of their models, both in order, and for lookup by `id`.

  // Create a new **Collection**, perhaps to contain a specific type of `model`.
  // If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.
  var Collection = Backbone.Collection = function(models, options) {
    options || (options = {});
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // Default options for `Collection#set`.
  var setOptions = {add: true, remove: true, merge: true};
  var addOptions = {add: true, remove: false};

  // Define the Collection's inheritable methods.
  _.extend(Collection.prototype, Events, {

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    model: Model,

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // The JSON representation of a Collection is an array of the
    // models' attributes.
    toJSON: function(options) {
      return this.map(function(model){ return model.toJSON(options); });
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Add a model, or list of models to the set.
    add: function(models, options) {
      return this.set(models, _.extend({merge: false}, options, addOptions));
    },

    // Remove a model, or a list of models from the set.
    remove: function(models, options) {
      var singular = !_.isArray(models);
      models = singular ? [models] : _.clone(models);
      options || (options = {});
      var i, l, index, model;
      for (i = 0, l = models.length; i < l; i++) {
        model = models[i] = this.get(models[i]);
        if (!model) continue;
        delete this._byId[model.id];
        delete this._byId[model.cid];
        index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model, options);
      }
      return singular ? models[0] : models;
    },

    // Update a collection by `set`-ing a new list of models, adding new ones,
    // removing models that are no longer present, and merging models that
    // already exist in the collection, as necessary. Similar to **Model#set**,
    // the core operation for updating the data contained by the collection.
    set: function(models, options) {
      options = _.defaults({}, options, setOptions);
      if (options.parse) models = this.parse(models, options);
      var singular = !_.isArray(models);
      models = singular ? (models ? [models] : []) : _.clone(models);
      var i, l, id, model, attrs, existing, sort;
      var at = options.at;
      var targetModel = this.model;
      var sortable = this.comparator && (at == null) && options.sort !== false;
      var sortAttr = _.isString(this.comparator) ? this.comparator : null;
      var toAdd = [], toRemove = [], modelMap = {};
      var add = options.add, merge = options.merge, remove = options.remove;
      var order = !sortable && add && remove ? [] : false;

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      for (i = 0, l = models.length; i < l; i++) {
        attrs = models[i] || {};
        if (attrs instanceof Model) {
          id = model = attrs;
        } else {
          id = attrs[targetModel.prototype.idAttribute || 'id'];
        }

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(id)) {
          if (remove) modelMap[existing.cid] = true;
          if (merge) {
            attrs = attrs === model ? model.attributes : attrs;
            if (options.parse) attrs = existing.parse(attrs, options);
            existing.set(attrs, options);
            if (sortable && !sort && existing.hasChanged(sortAttr)) sort = true;
          }
          models[i] = existing;

        // If this is a new, valid model, push it to the `toAdd` list.
        } else if (add) {
          model = models[i] = this._prepareModel(attrs, options);
          if (!model) continue;
          toAdd.push(model);
          this._addReference(model, options);
        }

        // Do not add multiple models with the same `id`.
        model = existing || model;
        if (order && (model.isNew() || !modelMap[model.id])) order.push(model);
        modelMap[model.id] = true;
      }

      // Remove nonexistent models if appropriate.
      if (remove) {
        for (i = 0, l = this.length; i < l; ++i) {
          if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
        }
        if (toRemove.length) this.remove(toRemove, options);
      }

      // See if sorting is needed, update `length` and splice in new models.
      if (toAdd.length || (order && order.length)) {
        if (sortable) sort = true;
        this.length += toAdd.length;
        if (at != null) {
          for (i = 0, l = toAdd.length; i < l; i++) {
            this.models.splice(at + i, 0, toAdd[i]);
          }
        } else {
          if (order) this.models.length = 0;
          var orderedModels = order || toAdd;
          for (i = 0, l = orderedModels.length; i < l; i++) {
            this.models.push(orderedModels[i]);
          }
        }
      }

      // Silently sort the collection if appropriate.
      if (sort) this.sort({silent: true});

      // Unless silenced, it's time to fire all appropriate add/sort events.
      if (!options.silent) {
        for (i = 0, l = toAdd.length; i < l; i++) {
          (model = toAdd[i]).trigger('add', model, this, options);
        }
        if (sort || (order && order.length)) this.trigger('sort', this, options);
      }

      // Return the added (or merged) model (or models).
      return singular ? models[0] : models;
    },

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any granular `add` or `remove` events. Fires `reset` when finished.
    // Useful for bulk operations and optimizations.
    reset: function(models, options) {
      options || (options = {});
      for (var i = 0, l = this.models.length; i < l; i++) {
        this._removeReference(this.models[i], options);
      }
      options.previousModels = this.models;
      this._reset();
      models = this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return models;
    },

    // Add a model to the end of the collection.
    push: function(model, options) {
      return this.add(model, _.extend({at: this.length}, options));
    },

    // Remove a model from the end of the collection.
    pop: function(options) {
      var model = this.at(this.length - 1);
      this.remove(model, options);
      return model;
    },

    // Add a model to the beginning of the collection.
    unshift: function(model, options) {
      return this.add(model, _.extend({at: 0}, options));
    },

    // Remove a model from the beginning of the collection.
    shift: function(options) {
      var model = this.at(0);
      this.remove(model, options);
      return model;
    },

    // Slice out a sub-array of models from the collection.
    slice: function() {
      return slice.apply(this.models, arguments);
    },

    // Get a model from the set by id.
    get: function(obj) {
      if (obj == null) return void 0;
      return this._byId[obj] || this._byId[obj.id] || this._byId[obj.cid];
    },

    // Get the model at the given index.
    at: function(index) {
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where: function(attrs, first) {
      if (_.isEmpty(attrs)) return first ? void 0 : [];
      return this[first ? 'find' : 'filter'](function(model) {
        for (var key in attrs) {
          if (attrs[key] !== model.get(key)) return false;
        }
        return true;
      });
    },

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere: function(attrs) {
      return this.where(attrs, true);
    },

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort: function(options) {
      if (!this.comparator) throw new Error('Cannot sort a set without a comparator');
      options || (options = {});

      // Run sort based on type of `comparator`.
      if (_.isString(this.comparator) || this.comparator.length === 1) {
        this.models = this.sortBy(this.comparator, this);
      } else {
        this.models.sort(_.bind(this.comparator, this));
      }

      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // Pluck an attribute from each model in the collection.
    pluck: function(attr) {
      return _.invoke(this.models, 'get', attr);
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      var collection = this;
      options.success = function(resp) {
        var method = options.reset ? 'reset' : 'set';
        collection[method](resp, options);
        if (success) success(collection, resp, options);
        collection.trigger('sync', collection, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      if (!(model = this._prepareModel(model, options))) return false;
      if (!options.wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(model, resp) {
        if (options.wait) collection.add(model, options);
        if (success) success(model, resp, options);
      };
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models);
    },

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    _reset: function() {
      this.length = 0;
      this.models = [];
      this._byId  = {};
    },

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    _prepareModel: function(attrs, options) {
      if (attrs instanceof Model) return attrs;
      options = options ? _.clone(options) : {};
      options.collection = this;
      var model = new this.model(attrs, options);
      if (!model.validationError) return model;
      this.trigger('invalid', this, model.validationError, options);
      return false;
    },

    // Internal method to create a model's ties to a collection.
    _addReference: function(model, options) {
      this._byId[model.cid] = model;
      if (model.id != null) this._byId[model.id] = model;
      if (!model.collection) model.collection = this;
      model.on('all', this._onModelEvent, this);
    },

    // Internal method to sever a model's ties to a collection.
    _removeReference: function(model, options) {
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    _onModelEvent: function(event, model, collection, options) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (model && event === 'change:' + model.idAttribute) {
        delete this._byId[model.previous(model.idAttribute)];
        if (model.id != null) this._byId[model.id] = model;
      }
      this.trigger.apply(this, arguments);
    }

  });

  // Underscore methods that we want to implement on the Collection.
  // 90% of the core usefulness of Backbone Collections is actually implemented
  // right here:
  var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'difference', 'indexOf', 'shuffle',
    'lastIndexOf', 'isEmpty', 'chain', 'sample'];

  // Mix in each Underscore method as a proxy to `Collection#models`.
  _.each(methods, function(method) {
    Collection.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.models);
      return _[method].apply(_, args);
    };
  });

  // Underscore methods that take a property name as an argument.
  var attributeMethods = ['groupBy', 'countBy', 'sortBy', 'indexBy'];

  // Use attributes instead of properties.
  _.each(attributeMethods, function(method) {
    Collection.prototype[method] = function(value, context) {
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _[method](this.models, iterator, context);
    };
  });

  // Backbone.View
  // -------------

  // Backbone Views are almost more convention than they are actual code. A View
  // is simply a JavaScript object that represents a logical chunk of UI in the
  // DOM. This might be a single item, an entire list, a sidebar or panel, or
  // even the surrounding frame which wraps your whole app. Defining a chunk of
  // UI as a **View** allows you to define your DOM events declaratively, without
  // having to worry about render order ... and makes it easy for the view to
  // react to specific changes in the state of your models.

  // Creating a Backbone.View creates its initial element outside of the DOM,
  // if an existing element is not provided...
  var View = Backbone.View = function(options) {
    this.cid = _.uniqueId('view');
    options || (options = {});
    _.extend(this, _.pick(options, viewOptions));
    this._ensureElement();
    this.initialize.apply(this, arguments);
    this.delegateEvents();
  };

  // Cached regex to split keys for `delegate`.
  var delegateEventSplitter = /^(\S+)\s*(.*)$/;

  // List of view options to be merged as properties.
  var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

  // Set up all inheritable **Backbone.View** properties and methods.
  _.extend(View.prototype, Events, {

    // The default `tagName` of a View's element is `"div"`.
    tagName: 'div',

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be preferred to global lookups where possible.
    $: function(selector) {
      return this.$el.find(selector);
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // **render** is the core function that your view should override, in order
    // to populate its element (`this.el`), with the appropriate HTML. The
    // convention is for **render** to always return `this`.
    render: function() {
      return this;
    },

    // Remove this view by taking the element out of the DOM, and removing any
    // applicable Backbone.Events listeners.
    remove: function() {
      this.$el.remove();
      this.stopListening();
      return this;
    },

    // Change the view's element (`this.el` property), including event
    // re-delegation.
    setElement: function(element, delegate) {
      if (this.$el) this.undelegateEvents();
      this.$el = element instanceof Backbone.$ ? element : Backbone.$(element);
      this.el = this.$el[0];
      if (delegate !== false) this.delegateEvents();
      return this;
    },

    // Set callbacks, where `this.events` is a hash of
    //
    // *{"event selector": "callback"}*
    //
    //     {
    //       'mousedown .title':  'edit',
    //       'click .button':     'save',
    //       'click .open':       function(e) { ... }
    //     }
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    // This only works for delegate-able events: not `focus`, `blur`, and
    // not `change`, `submit`, and `reset` in Internet Explorer.
    delegateEvents: function(events) {
      if (!(events || (events = _.result(this, 'events')))) return this;
      this.undelegateEvents();
      for (var key in events) {
        var method = events[key];
        if (!_.isFunction(method)) method = this[events[key]];
        if (!method) continue;

        var match = key.match(delegateEventSplitter);
        var eventName = match[1], selector = match[2];
        method = _.bind(method, this);
        eventName += '.delegateEvents' + this.cid;
        if (selector === '') {
          this.$el.on(eventName, method);
        } else {
          this.$el.on(eventName, selector, method);
        }
      }
      return this;
    },

    // Clears all callbacks previously bound to the view with `delegateEvents`.
    // You usually don't need to use this, but may wish to if you have multiple
    // Backbone views attached to the same DOM element.
    undelegateEvents: function() {
      this.$el.off('.delegateEvents' + this.cid);
      return this;
    },

    // Ensure that the View has a DOM element to render into.
    // If `this.el` is a string, pass it through `$()`, take the first
    // matching element, and re-assign it to `el`. Otherwise, create
    // an element from the `id`, `className` and `tagName` properties.
    _ensureElement: function() {
      if (!this.el) {
        var attrs = _.extend({}, _.result(this, 'attributes'));
        if (this.id) attrs.id = _.result(this, 'id');
        if (this.className) attrs['class'] = _.result(this, 'className');
        var $el = Backbone.$('<' + _.result(this, 'tagName') + '>').attr(attrs);
        this.setElement($el, false);
      } else {
        this.setElement(_.result(this, 'el'), false);
      }
    }

  });

  // Backbone.sync
  // -------------

  // Override this function to change the manner in which Backbone persists
  // models to the server. You will be passed the type of request, and the
  // model in question. By default, makes a RESTful Ajax request
  // to the model's `url()`. Some possible customizations could be:
  //
  // * Use `setTimeout` to batch rapid-fire updates into a single request.
  // * Send up the models as XML instead of JSON.
  // * Persist models via WebSockets instead of Ajax.
  //
  // Turn on `Backbone.emulateHTTP` in order to send `PUT` and `DELETE` requests
  // as `POST`, with a `_method` parameter containing the true HTTP method,
  // as well as all requests with the body as `application/x-www-form-urlencoded`
  // instead of `application/json` with the model in a param named `model`.
  // Useful when interfacing with server-side languages like **PHP** that make
  // it difficult to read the body of `PUT` requests.
  Backbone.sync = function(method, model, options) {
    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // If we're sending a `PATCH` request, and we're in an old Internet Explorer
    // that still has ActiveX enabled by default, override jQuery to use that
    // for XHR instead. Remove this line when jQuery supports `PATCH` on IE8.
    if (params.type === 'PATCH' && noXhrPatch) {
      params.xhr = function() {
        return new ActiveXObject("Microsoft.XMLHTTP");
      };
    }

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  var noXhrPatch =
    typeof window !== 'undefined' && !!window.ActiveXObject &&
      !(window.XMLHttpRequest && (new XMLHttpRequest).dispatchEvent);

  // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
  };

  // Set the default implementation of `Backbone.ajax` to proxy through to `$`.
  // Override this if you'd like to use a different library.
  Backbone.ajax = function() {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };

  // Backbone.Router
  // ---------------

  // Routers map faux-URLs to actions, and fire events when routes are
  // matched. Creating a new one sets its `routes` hash, if not set statically.
  var Router = Backbone.Router = function(options) {
    options || (options = {});
    if (options.routes) this.routes = options.routes;
    this._bindRoutes();
    this.initialize.apply(this, arguments);
  };

  // Cached regular expressions for matching named param parts and splatted
  // parts of route strings.
  var optionalParam = /\((.*?)\)/g;
  var namedParam    = /(\(\?)?:\w+/g;
  var splatParam    = /\*\w+/g;
  var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  // Set up all inheritable **Backbone.Router** properties and methods.
  _.extend(Router.prototype, Events, {

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Manually bind a single named route to a callback. For example:
    //
    //     this.route('search/:query/p:num', 'search', function(query, num) {
    //       ...
    //     });
    //
    route: function(route, name, callback) {
      if (!_.isRegExp(route)) route = this._routeToRegExp(route);
      if (_.isFunction(name)) {
        callback = name;
        name = '';
      }
      if (!callback) callback = this[name];
      var router = this;
      Backbone.history.route(route, function(fragment) {
        var args = router._extractParameters(route, fragment);
        router.execute(callback, args);
        router.trigger.apply(router, ['route:' + name].concat(args));
        router.trigger('route', name, args);
        Backbone.history.trigger('route', router, name, args);
      });
      return this;
    },

    // Execute a route handler with the provided parameters.  This is an
    // excellent place to do pre-route setup or post-route cleanup.
    execute: function(callback, args) {
      if (callback) callback.apply(this, args);
    },

    // Simple proxy to `Backbone.history` to save a fragment into the history.
    navigate: function(fragment, options) {
      Backbone.history.navigate(fragment, options);
      return this;
    },

    // Bind all defined routes to `Backbone.history`. We have to reverse the
    // order of the routes here to support behavior where the most general
    // routes can be defined at the bottom of the route map.
    _bindRoutes: function() {
      if (!this.routes) return;
      this.routes = _.result(this, 'routes');
      var route, routes = _.keys(this.routes);
      while ((route = routes.pop()) != null) {
        this.route(route, this.routes[route]);
      }
    },

    // Convert a route string into a regular expression, suitable for matching
    // against the current location hash.
    _routeToRegExp: function(route) {
      route = route.replace(escapeRegExp, '\\$&')
                   .replace(optionalParam, '(?:$1)?')
                   .replace(namedParam, function(match, optional) {
                     return optional ? match : '([^/?]+)';
                   })
                   .replace(splatParam, '([^?]*?)');
      return new RegExp('^' + route + '(?:\\?([\\s\\S]*))?$');
    },

    // Given a route, and a URL fragment that it matches, return the array of
    // extracted decoded parameters. Empty or unmatched parameters will be
    // treated as `null` to normalize cross-browser behavior.
    _extractParameters: function(route, fragment) {
      var params = route.exec(fragment).slice(1);
      return _.map(params, function(param, i) {
        // Don't decode the search params.
        if (i === params.length - 1) return param || null;
        return param ? decodeURIComponent(param) : null;
      });
    }

  });

  // Backbone.History
  // ----------------

  // Handles cross-browser history management, based on either
  // [pushState](http://diveintohtml5.info/history.html) and real URLs, or
  // [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
  // and URL fragments. If the browser supports neither (old IE, natch),
  // falls back to polling.
  var History = Backbone.History = function() {
    this.handlers = [];
    _.bindAll(this, 'checkUrl');

    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
      this.location = window.location;
      this.history = window.history;
    }
  };

  // Cached regex for stripping a leading hash/slash and trailing space.
  var routeStripper = /^[#\/]|\s+$/g;

  // Cached regex for stripping leading and trailing slashes.
  var rootStripper = /^\/+|\/+$/g;

  // Cached regex for detecting MSIE.
  var isExplorer = /msie [\w.]+/;

  // Cached regex for removing a trailing slash.
  var trailingSlash = /\/$/;

  // Cached regex for stripping urls of hash.
  var pathStripper = /#.*$/;

  // Has the history handling already been started?
  History.started = false;

  // Set up all inheritable **Backbone.History** properties and methods.
  _.extend(History.prototype, Events, {

    // The default interval to poll for hash changes, if necessary, is
    // twenty times a second.
    interval: 50,

    // Are we at the app root?
    atRoot: function() {
      return this.location.pathname.replace(/[^\/]$/, '$&/') === this.root;
    },

    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash: function(window) {
      var match = (window || this).location.href.match(/#(.*)$/);
      return match ? match[1] : '';
    },

    // Get the cross-browser normalized URL fragment, either from the URL,
    // the hash, or the override.
    getFragment: function(fragment, forcePushState) {
      if (fragment == null) {
        if (this._hasPushState || !this._wantsHashChange || forcePushState) {
          fragment = decodeURI(this.location.pathname + this.location.search);
          var root = this.root.replace(trailingSlash, '');
          if (!fragment.indexOf(root)) fragment = fragment.slice(root.length);
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start: function(options) {
      if (History.started) throw new Error("Backbone.history has already been started");
      History.started = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options          = _.extend({root: '/'}, this.options, options);
      this.root             = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._wantsPushState  = !!this.options.pushState;
      this._hasPushState    = !!(this.options.pushState && this.history && this.history.pushState);
      var fragment          = this.getFragment();
      var docMode           = document.documentMode;
      var oldIE             = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      if (oldIE && this._wantsHashChange) {
        var frame = Backbone.$('<iframe src="javascript:0" tabindex="-1">');
        this.iframe = frame.hide().appendTo('body')[0].contentWindow;
        this.navigate(fragment);
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._hasPushState) {
        Backbone.$(window).on('popstate', this.checkUrl);
      } else if (this._wantsHashChange && ('onhashchange' in window) && !oldIE) {
        Backbone.$(window).on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      // Determine if we need to change the base url, for a pushState link
      // opened by a non-pushState browser.
      this.fragment = fragment;
      var loc = this.location;

      // Transition from hashChange to pushState or vice versa if both are
      // requested.
      if (this._wantsHashChange && this._wantsPushState) {

        // If we've started off with a route from a `pushState`-enabled
        // browser, but we're currently in a browser that doesn't support it...
        if (!this._hasPushState && !this.atRoot()) {
          this.fragment = this.getFragment(null, true);
          this.location.replace(this.root + '#' + this.fragment);
          // Return immediately as browser will do redirect to new url
          return true;

        // Or if we've started out with a hash-based route, but we're currently
        // in a browser where it could be `pushState`-based instead...
        } else if (this._hasPushState && this.atRoot() && loc.hash) {
          this.fragment = this.getHash().replace(routeStripper, '');
          this.history.replaceState({}, document.title, this.root + this.fragment);
        }

      }

      if (!this.options.silent) return this.loadUrl();
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop: function() {
      Backbone.$(window).off('popstate', this.checkUrl).off('hashchange', this.checkUrl);
      if (this._checkUrlInterval) clearInterval(this._checkUrlInterval);
      History.started = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route: function(route, callback) {
      this.handlers.unshift({route: route, callback: callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl: function(e) {
      var current = this.getFragment();
      if (current === this.fragment && this.iframe) {
        current = this.getFragment(this.getHash(this.iframe));
      }
      if (current === this.fragment) return false;
      if (this.iframe) this.navigate(current);
      this.loadUrl();
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl: function(fragment) {
      fragment = this.fragment = this.getFragment(fragment);
      return _.any(this.handlers, function(handler) {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate: function(fragment, options) {
      if (!History.started) return false;
      if (!options || options === true) options = {trigger: !!options};

      var url = this.root + (fragment = this.getFragment(fragment || ''));

      // Strip the hash for matching.
      fragment = fragment.replace(pathStripper, '');

      if (this.fragment === fragment) return;
      this.fragment = fragment;

      // Don't include a trailing slash on the root.
      if (fragment === '' && url !== '/') url = url.slice(0, -1);

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._hasPushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getFragment(this.getHash(this.iframe)))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          if(!options.replace) this.iframe.document.open().close();
          this._updateHash(this.iframe.location, fragment, options.replace);
        }

      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) return this.loadUrl(fragment);
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash: function(location, fragment, replace) {
      if (replace) {
        var href = location.href.replace(/(javascript:|#).*$/, '');
        location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        location.hash = '#' + fragment;
      }
    }

  });

  // Create the default Backbone.history.
  Backbone.history = new History;

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  var extend = function(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };

  // Set up inheritance for the model, collection, router, view and history.
  Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

  // Throw an error when a URL is needed, and none is supplied.
  var urlError = function() {
    throw new Error('A "url" property or function must be specified');
  };

  // Wrap an optional error callback with a fallback error event.
  var wrapError = function(model, options) {
    var error = options.error;
    options.error = function(resp) {
      if (error) error(model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };

  return Backbone;

}));

!function(a){var b=a.document;b&&(Date.now||(Date.now=function(){return+new Date}),String.prototype.trim||(String.prototype.trim=function(){return this.replace(/^\s+/,"").replace(/\s+$/,"")}),Object.keys||(Object.keys=function(){var a=Object.prototype.hasOwnProperty,b=!{toString:null}.propertyIsEnumerable("toString"),c=["toString","toLocaleString","valueOf","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","constructor"],d=c.length;return function(e){if("object"!=typeof e&&"function"!=typeof e||null===e)throw new TypeError("Object.keys called on non-object");var f=[];for(var g in e)a.call(e,g)&&f.push(g);if(b)for(var h=0;d>h;h++)a.call(e,c[h])&&f.push(c[h]);return f}}()),Array.prototype.indexOf||(Array.prototype.indexOf=function(a,b){var c;for(void 0===b&&(b=0),0>b&&(b+=this.length),0>b&&(b=0),c=this.length;c>b;b++)if(this.hasOwnProperty(b)&&this[b]===a)return b;return-1}),Array.prototype.forEach||(Array.prototype.forEach=function(a,b){var c,d;for(c=0,d=this.length;d>c;c+=1)this.hasOwnProperty(c)&&a.call(b,this[c],c,this)}),Array.prototype.map||(Array.prototype.map=function(a,b){var c,d,e=[];for(c=0,d=this.length;d>c;c+=1)this.hasOwnProperty(c)&&(e[c]=a.call(b,this[c],c,this));return e}),Array.prototype.filter||(Array.prototype.filter=function(a,b){var c,d,e=[];for(c=0,d=this.length;d>c;c+=1)this.hasOwnProperty(c)&&a.call(b,this[c],c,this)&&(e[e.length]=this[c]);return e}),a.addEventListener||!function(a,b){var c,d,e,f,g,h;c=function(a,b){var c,d=this;for(c in a)d[c]=a[c];d.currentTarget=b,d.target=a.srcElement||b,d.timeStamp=+new Date,d.preventDefault=function(){a.returnValue=!1},d.stopPropagation=function(){a.cancelBubble=!0}},d=function(a,b){var d,e,f=this;d=f.listeners||(f.listeners=[]),e=d.length,d[e]=[b,function(a){b.call(f,new c(a,f))}],f.attachEvent("on"+a,d[e][1])},e=function(a,b){var c,d,e=this;if(e.listeners)for(c=e.listeners,d=c.length;d--;)c[d][0]===b&&e.detachEvent("on"+a,c[d][1])},a.addEventListener=b.addEventListener=d,a.removeEventListener=b.removeEventListener=e,"Element"in a?(Element.prototype.addEventListener=d,Element.prototype.removeEventListener=e):(h=b.createElement,b.createElement=function(a){var b=h(a);return b.addEventListener=d,b.removeEventListener=e,b},f=b.getElementsByTagName("head")[0],g=b.createElement("style"),f.insertBefore(g,f.firstChild))}(a,b),a.getComputedStyle||(a.getComputedStyle=function(){function a(b,c,d,e){var f,g=c[d],h=parseFloat(g),i=g.split(/\d/)[0];return e=null!=e?e:/%|em/.test(i)&&b.parentElement?a(b.parentElement,b.parentElement.currentStyle,"fontSize",null):16,f="fontSize"==d?e:/width/i.test(d)?b.clientWidth:b.clientHeight,"em"==i?h*e:"in"==i?96*h:"pt"==i?96*h/72:"%"==i?h/100*f:h}function b(a,b){var c="border"==b?"Width":"",d=b+"Top"+c,e=b+"Right"+c,f=b+"Bottom"+c,g=b+"Left"+c;a[b]=(a[d]==a[e]==a[f]==a[g]?[a[d]]:a[d]==a[f]&&a[g]==a[e]?[a[d],a[e]]:a[g]==a[e]?[a[d],a[e],a[f]]:[a[d],a[e],a[f],a[g]]).join(" ")}function c(c){var d,e,f,g;d=c.currentStyle,e=this,f=a(c,d,"fontSize",null);for(g in d)/width|height|margin.|padding.|border.+W/.test(g)&&"auto"!==e[g]?e[g]=a(c,d,g,f)+"px":"styleFloat"===g?e.float=d[g]:e[g]=d[g];return b(e,"margin"),b(e,"padding"),b(e,"border"),e.fontSize=f+"px",e}function d(a){return new c(a)}return c.prototype={constructor:c,getPropertyPriority:function(){},getPropertyValue:function(a){return this[a]||""},item:function(){},removeProperty:function(){},setProperty:function(){},getPropertyCSSValue:function(){}},d}()))}("undefined"!=typeof window?window:this),function(a){var b=function(){return"undefined"!=typeof document?document&&document.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#BasicStructure","1.1"):void 0}(),c=function(){var a;try{Object.create(null),a=Object.create}catch(b){a=function(){var a=function(){};return function(b,c){var d;return null===b?{}:(a.prototype=b,d=new a,c&&Object.defineProperties(d,c),d)}}()}return a}(),d={html:"http://www.w3.org/1999/xhtml",mathml:"http://www.w3.org/1998/Math/MathML",svg:"http://www.w3.org/2000/svg",xlink:"http://www.w3.org/1999/xlink",xml:"http://www.w3.org/XML/1998/namespace",xmlns:"http://www.w3.org/2000/xmlns/"},e=function(a,b){return a?function(a,b){return b?document.createElementNS(b,a):document.createElement(a)}:function(a,c){if(c&&c!==b.html)throw"This browser does not support namespaces other than http://www.w3.org/1999/xhtml. The most likely cause of this error is that you're trying to render SVG in an older browser. See https://github.com/RactiveJS/Ractive/wiki/SVG-and-older-browsers for more information";return document.createElement(a)}}(b,d),f=function(){return"object"==typeof document?!0:!1}(),g=function(a){try{return Object.defineProperty({},"test",{value:0}),a&&Object.defineProperty(document.createElement("div"),"test",{value:0}),Object.defineProperty}catch(b){return function(a,b,c){a[b]=c.value}}}(f),h=function(a,b,c){try{try{Object.defineProperties({},{test:{value:0}})}catch(d){throw d}return c&&Object.defineProperties(a("div"),{test:{value:0}}),Object.defineProperties}catch(d){return function(a,c){var d;for(d in c)c.hasOwnProperty(d)&&b(a,d,c[d])}}}(e,g,f),i=function(){var a=/\[\s*(\*|[0-9]|[1-9][0-9]+)\s*\]/g;return function(b){return(b||"").replace(a,".$1")}}(),j={},k={TEXT:1,INTERPOLATOR:2,TRIPLE:3,SECTION:4,INVERTED:5,CLOSING:6,ELEMENT:7,PARTIAL:8,COMMENT:9,DELIMCHANGE:10,MUSTACHE:11,TAG:12,ATTRIBUTE:13,COMPONENT:15,NUMBER_LITERAL:20,STRING_LITERAL:21,ARRAY_LITERAL:22,OBJECT_LITERAL:23,BOOLEAN_LITERAL:24,GLOBAL:26,KEY_VALUE_PAIR:27,REFERENCE:30,REFINEMENT:31,MEMBER:32,PREFIX_OPERATOR:33,BRACKETED:34,CONDITIONAL:35,INFIX_OPERATOR:36,INVOCATION:40},l=function(){var a=Object.prototype.toString;return function(b){return"[object Array]"===a.call(b)}}(),m=function(){return function a(b,c){var d,e;if((e=b._wrapped[c])&&e.teardown()!==!1&&(b._wrapped[c]=null),b._cache[c]=void 0,d=b._cacheMap[c])for(;d.length;)a(b,d.pop())}}(),n=function(){return function(a,b){var c,d,e,f,g,h;for(c=[],h=a.rendered?a.el:a.fragment.docFrag,d=h.querySelectorAll('input[type="checkbox"][name="{{'+b+'}}"]'),f=d.length,g=0;f>g;g+=1)e=d[g],(e.hasAttribute("checked")||e.checked)&&(c[c.length]=e._ractive.value);return c}}(),o=function(a){return function(b){var c,d,e,f,g,h;for(c=b._deferred;d=c.evals.pop();)d.update().deferred=!1;for(;e=c.selectValues.pop();)e.deferredUpdate();for(;f=c.attrs.pop();)f.update().deferred=!1;for(;g=c.checkboxes.pop();)b.set(g,a(b,g));for(;h=c.radios.pop();)h.update()}}(n),p=function(){return function(a){var b,c,d,e,f,g;for(b=a._deferred,(c=b.focusable)&&(c.focus(),b.focusable=null);d=b.liveQueries.pop();)d._sort();for(;e=b.decorators.pop();)e.init();for(;f=b.transitions.pop();)f.init();for(;g=b.observers.pop();)g.update()}}(),q=function(){var a=function(a,b){var c,d,e,f;return a._parent&&a._parent._transitionManager?a._parent._transitionManager:(d=[],e=function(){var a,b;for(a=d.length;a--;)b=d[a],f(b.node)&&(b.detach(),d.splice(a,1))},f=function(a){var b,d;for(b=c.active.length;b--;)if(d=c.active[b],a.contains(d))return!1;return!0},c={active:[],push:function(a){c.active[c.active.length]=a},pop:function(a){var b;b=c.active.indexOf(a),-1!==b&&(c.active.splice(b,1),e(),!c.active.length&&c._ready&&c.complete())},complete:function(){b&&b.call(a)},ready:function(){e(),c._ready=!0,c.active.length||c.complete()},detachWhenReady:function(a){d[d.length]=a}})};return a}(),r=function(){function a(a,d,e,f){var g=a._deps[e];g&&(b(g[d]),f||c(a._depsMap[d],a,e))}function b(a){var b,c;if(a)for(c=a.length,b=0;c>b;b+=1)a[b].update()}function c(b,c,d,e){var f;if(b)for(f=b.length;f--;)a(c,b[f],d,e)}function d(a,b,c,f,g){var i,j,k,l,m,n,o,p;for(i=a._patternObservers.length;i--;)j=a._patternObservers[i],j.regex.test(c)&&j.update(c);f||(p=function(b){if(k=a._depsMap[b])for(i=k.length;i--;)l=k[i],m=h.exec(l)[0],n=c+"."+m,d(a,l,n)},g?(o=e(c),o.forEach(p)):p(b))}function e(a){var b,c,d,e,g,h;for(b=a.split("."),c=f(b.length),g=[],d=function(a,c){return a?"*":b[c]},e=c.length;e--;)h=c[e].map(d).join("."),g[h]||(g[g.length]=h,g[h]=!0);return g}function f(a){var b,c,d,e,f,g="";if(!i[a]){for(d=[];g.length<a;)g+=1;for(b=parseInt(g,2),e=function(a){return"1"===a},f=0;b>=f;f+=1){for(c=f.toString(2);c.length<a;)c="0"+c;d[f]=Array.prototype.map.call(c,e)}i[a]=d}return i[a]}var g,h,i={};return h=/[^\.]+$/,g=function(b,c,e){var f;for(b._patternObservers.length&&d(b,c,c,e,!0),f=0;f<b._deps.length;f+=1)a(b,c,f,e)},g.multiple=function(b,c,e){var f,g,h;if(h=c.length,b._patternObservers.length)for(f=h;f--;)d(b,c[f],c[f],e,!0);for(f=0;f<b._deps.length;f+=1)if(b._deps[f])for(g=h;g--;)a(b,c[g],f,e)},g}(),s=function(a,b,c,d,e,f,g,h){var i,j,k,l,m,n,o,p,q,r;return i={filter:function(a){return c(a)&&(!a._ractive||!a._ractive.setting)},wrap:function(a,b,c){return new k(a,b,c)}},k=function(a,c,d){this.root=a,this.value=c,this.keypath=d,c._ractive||(b(c,"_ractive",{value:{wrappers:[],instances:[],setting:!1},configurable:!0}),l(c)),c._ractive.instances[a._guid]||(c._ractive.instances[a._guid]=0,c._ractive.instances.push(a)),c._ractive.instances[a._guid]+=1,c._ractive.wrappers.push(this)},k.prototype={get:function(){return this.value},teardown:function(){var a,b,c,d,e;if(a=this.value,b=a._ractive,c=b.wrappers,d=b.instances,b.setting)return!1;if(e=c.indexOf(this),-1===e)throw new Error(r);if(c.splice(e,1),c.length){if(d[this.root._guid]-=1,!d[this.root._guid]){if(e=d.indexOf(this.root),-1===e)throw new Error(r);d.splice(e,1)}}else delete a._ractive,m(this.value)}},j=function(b,c,f){var g,i,j,k,l;for(g=function(a,g){var j,k,l,m,n,o,p,q,r,s,t,u;if("sort"===c||"reverse"===c)return a.set(g,b),void 0;for(d(a,g),n=[],o=[],p=0;p<a._deps.length;p+=1)if(j=a._deps[p],j&&(k=j[g])){for(i(g,k,n,o),e(a);n.length;)n.pop().smartUpdate(c,f);for(;o.length;)o.pop().update()}if("splice"===c&&f.length>2&&f[1])for(q=Math.min(f[1],f.length-2),r=f[0],s=r+q,f[1]===f.length-2&&(u=!0),p=r;s>p;p+=1)t=g+"."+p,h(a,t);for(e(a),m=[],l=g.split(".");l.length;)l.pop(),m[m.length]=l.join(".");h.multiple(a,m,!0),u||h(a,g+".length",!0)},i=function(b,c,d,e){var f,g;for(f=c.length;f--;)g=c[f],g.type===a.REFERENCE?g.update():g.keypath===b&&g.type===a.SECTION&&!g.inverted&&g.docFrag?d[d.length]=g:e[e.length]=g},j=b._ractive.wrappers,l=j.length;l--;)k=j[l],g(k.root,k.keypath)},n=[],p=["pop","push","reverse","shift","sort","splice","unshift"],q=function(){},p.forEach(function(a){var c=function(){var b,c,d,h,i={},k={};for(b=Array.prototype[a].apply(this,arguments),c=this._ractive.instances,h=c.length;h--;)d=c[h],i[d._guid]=d._transitionManager,d._transitionManager=k[d._guid]=g(d,q);for(this._ractive.setting=!0,j(this,a,arguments),this._ractive.setting=!1,h=c.length;h--;)d=c[h],d._transitionManager=i[d._guid],k[d._guid].ready(),e(d),f(d);return b};b(n,a,{value:c})}),o={},o.__proto__?(l=function(a){a.__proto__=n},m=function(a){a.__proto__=Array.prototype}):(l=function(a){var c,d;for(c=p.length;c--;)d=p[c],b(a,d,{value:n[d],configurable:!0})},m=function(a){var b;for(b=p.length;b--;)delete a[p[b]]}),r="Something went wrong in a rather interesting way",i}(k,g,l,m,o,p,q,r),t=function(){var a,b;try{Object.defineProperty({},"test",{value:0})}catch(c){return!1}return a={filter:function(a,b){return!!b},wrap:function(a,c,d){return new b(a,c,d)}},b=function(a,b,c){var d,e,f,g,h,i,j,k,l,m=this;if(this.ractive=a,this.keypath=c,d=c.split("."),this.prop=d.pop(),f=d.join("."),this.obj=f?a.get(f):a.data,g=this.originalDescriptor=Object.getOwnPropertyDescriptor(this.obj,this.prop),g&&g.set&&(h=g.set._ractiveWrappers))return-1===h.indexOf(this)&&h.push(this),void 0;if(g&&!g.configurable)throw new Error('Cannot use magic mode with property "'+e+'" - object is not configurable');g&&(this.value=g.value,i=g.get,j=g.set),k=i||function(){return m.value},l=function(a){var b,c,d;for(j&&j(a),b=l._ractiveWrappers,d=b.length;d--;)c=b[d],c.resetting||c.ractive.set(c.keypath,a)},l._ractiveWrappers=[this],Object.defineProperty(this.obj,this.prop,{get:k,set:l,enumerable:!0,configurable:!0})},b.prototype={get:function(){return this.value},reset:function(a){this.resetting=!0,this.value=a,this.resetting=!1},teardown:function(){var a,b,c,d;a=Object.getOwnPropertyDescriptor(this.obj,this.prop),b=a.set,d=b._ractiveWrappers,d.splice(d.indexOf(this),1),d.length||(c=this.obj[this.prop],Object.defineProperty(this.obj,this.prop,this.originalDescriptor||{writable:!0,enumerable:!0,configrable:!0}),this.obj[this.prop]=c)}},a}(),u=function(a,b,c){function d(a,b){var c,d={};if(!b)return a;b+=".";for(c in a)a.hasOwnProperty(c)&&(d[b+c]=a[c]);return d}function e(a){var b;return f[a]||(b=a?a+".":"",f[a]=function(c,e){var f;return"string"==typeof c?(f={},f[b+c]=e,f):"object"==typeof c?b?d(c,a):c:void 0}),f[a]}var f={};return function(d,f,g,h){var i,j,k,l;for(i=d.adaptors.length,j=0;i>j;j+=1){if(k=d.adaptors[j],"string"==typeof k){if(!a[k])throw new Error('Missing adaptor "'+k+'"');k=d.adaptors[j]=a[k]}if(k.filter(g,f,d))return l=d._wrapped[f]=k.wrap(d,g,f,e(f)),l.value=g,void 0}h||(d.magic&&c.filter(g,f,d)?d._wrapped[f]=c.wrap(d,g,f):d.modifyArrays&&b.filter(g,f,d)&&(d._wrapped[f]=b.wrap(d,g,f)))}}(j,s,t),v=function(a,b,c){var d,e,f;return d=function(a){return this._captured&&!this._captured[a]&&(this._captured.push(a),this._captured[a]=!0),e(this,a)},e=function(b,d){var e,g,h,i,j;return d=a(d),e=b._cache,void 0!==(g=e[d])?g:((i=b._wrapped[d])?h=i.value:d?h=(j=b._evaluators[d])?j.value:f(b,d):(c(b,"",b.data),h=b.data),e[d]=h,h)},f=function(a,b){var d,f,g,h,i,j,k;return d=b.split("."),f=d.pop(),g=d.join("."),h=e(a,g),(k=a._wrapped[g])&&(h=k.get()),null!==h&&void 0!==h?((i=a._cacheMap[g])?-1===i.indexOf(b)&&(i[i.length]=b):a._cacheMap[g]=[b],j=h[f],c(a,b,j),a._cache[b]=j,j):void 0},d}(i,j,u),w=function(){var a=Object.prototype.toString;return function(b){return"object"==typeof b&&"[object Object]"===a.call(b)}}(),x=function(){return function(a,b){return null===a&&null===b?!0:"object"==typeof a||"object"==typeof b?!1:a===b}}(),y=function(){var a;return a=function(a,b,c){var d,e,f,g,h,i,j,k,l,m,n;if(n='Could not resolve reference - too many "../" prefixes',"."===b){if(!c.length)return"";d=c[c.length-1]}else if("."===b.charAt(0))if(m=c[c.length-1],g=m?m.split("."):[],"../"===b.substr(0,3)){for(;"../"===b.substr(0,3);){if(!g.length)throw new Error(n);g.pop(),b=b.substring(3)}g.push(b),d=g.join(".")}else d=m?m+b:b.substring(1);else{for(e=b.split("."),f=e.pop(),i=e.length?"."+e.join("."):"",c=c.concat();c.length;)if(h=c.pop(),j=h+i,k=a.get(j),(l=a._wrapped[j])&&(k=l.get()),"object"==typeof k&&null!==k&&k.hasOwnProperty(f)){d=h+"."+b;break}d||void 0===a.get(b)||(d=b)}return d?d.replace(/^\./,""):d}}(),z=function(a){var b=Array.prototype.push;return function(c){for(var d,e,f;d=c._pendingResolution.pop();)e=a(c,d.ref,d.contextStack),void 0!==e?d.resolve(e):(f||(f=[])).push(d);f&&b.apply(c._pendingResolution,f)}}(y),A=function(a,b){return function(c){a(c),b(c)}}(o,p),B=function(){return function(a,b,c){var d,e,f,g,h,i,j;for(d=b.split("."),e=[],(f=a._wrapped[""])?(f.set&&f.set(d.join("."),c),g=f.get()):g=a.data;d.length>1;)h=e[e.length]=d.shift(),i=e.join("."),(f=a._wrapped[i])?(f.set&&f.set(d.join("."),c),g=f.get()):(g.hasOwnProperty(h)||(j||(j=i),g[h]=/^\s*[0-9]+\s*$/.test(d[0])?[]:{}),g=g[h]);return h=d[0],g[h]=c,j}}(),C=function(a,b,c,d,e,f,g,h,i){var j,k,l,m;return j=function(b,d,i){var j,m,n,o,p,q,r;if(m=[],a(b)&&(j=b,i=d),j)for(b in j)j.hasOwnProperty(b)&&(d=j[b],b=c(b),k(this,b,d,m));else b=c(b),k(this,b,d,m);if(m.length){if(o=this._transitionManager,this._transitionManager=p=g(this,i),n=l(m),n.length&&e.multiple(this,n,!0),e.multiple(this,m),this._pendingResolution.length&&f(this),h(this),this._transitionManager=o,p.ready(),!this.firingChangeEvent){for(this.firingChangeEvent=!0,r={},q=m.length;q--;)r[m[q]]=this.get(m[q]);this.fire("change",r),this.firingChangeEvent=!1}return this}},k=function(a,b,c,e){var f,g,h,j,k;if(!(h=a._wrapped[b])||!h.reset||m(a,b,c,h,e)===!1){if((k=a._evaluators[b])&&(k.value=c),f=a._cache[b],g=a.get(b),g===c||k){if(c===f&&"object"!=typeof c)return}else j=i(a,b,c);d(a,j||b),e[e.length]=b}},l=function(a){var b,c,d,e,f=[""];for(b=a.length;b--;)for(c=a[b],d=c.split(".");d.length>1;)d.pop(),e=d.join("."),f[e]||(f[f.length]=e,f[e]=!0);return f},m=function(a,c,e,f,g){var h,i,j,k;if(h=f.get(),!b(h,e)&&f.reset(e)===!1)return!1;if(e=f.get(),i=a._cache[c],!b(i,e)){if(a._cache[c]=e,j=a._cacheMap[c])for(k=j.length;k--;)d(a,j[k]);g[g.length]=c}},j}(w,x,i,m,r,z,q,A,B),D=function(a,b,c,d,e){return function(f,g){var h,i;return"function"==typeof f&&(g=f,f=""),i=this._transitionManager,this._transitionManager=h=a(this,g),b(this),c(this,f||""),d(this,f||""),e(this),this._transitionManager=i,h.ready(),"string"==typeof f?this.fire("update",f):this.fire("update"),this}}(q,z,m,r,A),E=function(a){return function(b,c){var d;if(!a(b)||!a(c))return!1;if(b.length!==c.length)return!1;for(d=b.length;d--;)if(b[d]!==c[d])return!1;return!0}}(l),F=function(a,b,c){function d(a,e,f,g,h){var i,j,k,l,m,n;if(i=a._twowayBindings[e])for(k=i.length;k--;)l=i[k],(!l.radioName||l.node.checked)&&(l.checkboxName?l.changed()&&!g[e]&&(g[e]=!0,g[g.length]=e):(m=l.attr.value,n=l.value(),b(m,n)||c(m,n)||(f[e]=n)));if(h&&(j=a._depsMap[e]))for(k=j.length;k--;)d(a,j[k],f,g,h)}return function(b,c){var e,f,g;if("string"!=typeof b&&(b="",c=!0),d(this,b,e={},f=[],c),g=f.length)for(;g--;)b=f[g],e[b]=a(this,b);this.set(e)}}(n,E,x),G=function(){return"undefined"!=typeof window?(function(a,b,c){var d,e;if(!c.requestAnimationFrame){for(d=0;d<a.length&&!c.requestAnimationFrame;++d)c.requestAnimationFrame=c[a[d]+"RequestAnimationFrame"];c.requestAnimationFrame||(e=c.setTimeout,c.requestAnimationFrame=function(a){var c,d,f;return c=Date.now(),d=Math.max(0,16-(c-b)),f=e(function(){a(c+d)},d),b=c+d,f})}}(["ms","moz","webkit","o"],0,window),window.requestAnimationFrame):void 0}(),H=function(a){var b=[],c={tick:function(){var d,e;for(d=0;d<b.length;d+=1)e=b[d],e.tick()||b.splice(d--,1);b.length?a(c.tick):c.running=!1},add:function(a){b[b.length]=a,c.running||(c.running=!0,c.tick())},abort:function(a,c){for(var d,e=b.length;e--;)d=b[e],d.root===c&&d.keypath===a&&d.stop()}};return c}(G),I=function(){return"undefined"!=typeof console&&"function"==typeof console.warn&&"function"==typeof console.warn.apply?function(){console.warn.apply(console,arguments)}:function(){}}(),J=function(){return function(a){return!isNaN(parseFloat(a))&&isFinite(a)}}(),K=function(a,b,c){function d(a,b){var c=b-a;return c?function(b){return a+b*c}:function(){return a}}function e(a,b){var c,d,e,f;for(c=[],d=[],f=e=Math.min(a.length,b.length);f--;)d[f]=g(a[f],b[f]);for(f=e;f<a.length;f+=1)c[f]=a[f];for(f=e;f<b.length;f+=1)c[f]=b[f];return function(a){for(var b=e;b--;)c[b]=d[b](a);return c}}function f(a,b){var c,d,e,f,h=[];e={},d={};for(f in a)a.hasOwnProperty(f)&&(b.hasOwnProperty(f)?(h[h.length]=f,d[f]=g(a[f],b[f])):e[f]=a[f]);for(f in b)b.hasOwnProperty(f)&&!a.hasOwnProperty(f)&&(e[f]=b[f]);return c=h.length,function(a){for(var b,f=c;f--;)b=h[f],e[b]=d[b](a);return e}}var g=function(g,h){return c(g)&&c(h)?d(+g,+h):a(g)&&a(h)?e(g,h):b(g)&&b(h)?f(g,h):function(){return h}};return g}(l,w,J),L=function(a,b){var c=function(a){var c;this.startTime=Date.now();for(c in a)a.hasOwnProperty(c)&&(this[c]=a[c]);this.interpolator=b(this.from,this.to),this.running=!0};return c.prototype={tick:function(){var b,c,d,e,f,g;return g=this.keypath,this.running?(e=Date.now(),b=e-this.startTime,b>=this.duration?(null!==g&&this.root.set(g,this.to),this.step&&this.step(1,this.to),this.complete&&this.complete(1,this.to),f=this.root._animations.indexOf(this),-1===f&&a("Animation was not found"),this.root._animations.splice(f,1),this.running=!1,!1):(c=this.easing?this.easing(b/this.duration):b/this.duration,null!==g&&(d=this.interpolator(c),this.root.set(g,d)),this.step&&this.step(c,d),!0)):!1},stop:function(){var b;this.running=!1,b=this.root._animations.indexOf(this),-1===b&&a("Animation was not found"),this.root._animations.splice(b,1)}},c}(I,K),M=function(){return{linear:function(a){return a},easeIn:function(a){return Math.pow(a,3)},easeOut:function(a){return Math.pow(a-1,3)+1},easeInOut:function(a){return(a/=.5)<1?.5*Math.pow(a,3):.5*(Math.pow(a-2,3)+2)}}}(),N=function(a,b,c,d){function e(e,g,h,i){var j,k,l,m;return null!==g&&(m=e.get(g)),b.abort(g,e),a(m,h)?(i.complete&&i.complete(1,i.to),f):(i.easing&&(j="function"==typeof i.easing?i.easing:e.easing&&e.easing[i.easing]?e.easing[i.easing]:d[i.easing],"function"!=typeof j&&(j=null)),k=void 0===i.duration?400:i.duration,l=new c({keypath:g,from:m,to:h,root:e,duration:k,easing:j,step:i.step,complete:i.complete}),b.add(l),e._animations[e._animations.length]=l,l)}var f={stop:function(){}};return function(a,b,c){var d,f,g,h,i,j,k,l,m,n,o,p;if("object"==typeof a){c=b||{},h=c.easing,i=c.duration,g=[],j=c.step,k=c.complete,(j||k)&&(m={},c.step=null,c.complete=null,l=function(a){return function(b,c){m[a]=c}});for(d in a)a.hasOwnProperty(d)&&((j||k)&&(n=l(d),c={easing:h,duration:i},j&&(c.step=n),k&&(c.complete=n)),g[g.length]=e(this,d,a[d],c));return(j||k)&&(p={easing:h,duration:i},j&&(p.step=function(a){j(a,m)}),k&&(p.complete=function(a){k(a,m)}),g[g.length]=o=e(this,null,null,p)),{stop:function(){for(;g.length;)g.pop().stop();o&&o.stop()}}}return c=c||{},f=e(this,a,b,c),{stop:function(){f.stop()}}}}(x,H,L,M),O=function(){return function(a,b){var c,d,e=this;if("object"==typeof a){c=[];for(d in a)a.hasOwnProperty(d)&&(c[c.length]=this.on(d,a[d]));return{cancel:function(){for(;c.length;)c.pop().cancel()}}}return this._subs[a]?this._subs[a].push(b):this._subs[a]=[b],{cancel:function(){e.off(a,b)}}}}(),P=function(){return function(a,b){var c,d;if(!b)if(a)this._subs[a]=[];else for(a in this._subs)delete this._subs[a];c=this._subs[a],c&&(d=c.indexOf(b),-1!==d&&c.splice(d,1))}}(),Q=function(){return function(a){var b,c,d,e,f,g,h,i;if(g=a.root,h=a.keypath,i=a.priority,b=g._deps[i]||(g._deps[i]={}),c=b[h]||(b[h]=[]),c[c.length]=a,a.registered=!0,h)for(d=h.split(".");d.length;)d.pop(),e=d.join("."),f=g._depsMap[e]||(g._depsMap[e]=[]),void 0===f[h]&&(f[h]=0,f[f.length]=h),f[h]+=1,h=e}}(),R=function(){return function(a){var b,c,d,e,f,g,h,i;if(g=a.root,h=a.keypath,i=a.priority,b=g._deps[i][h],c=b.indexOf(a),-1===c||!a.registered)throw new Error("Attempted to remove a dependant that was no longer registered! This should not happen. If you are seeing this bug in development please raise an issue at https://github.com/RactiveJS/Ractive/issues - thanks");if(b.splice(c,1),a.registered=!1,h)for(d=h.split(".");d.length;)d.pop(),e=d.join("."),f=g._depsMap[e],f[h]-=1,f[h]||(f.splice(f.indexOf(h),1),f[h]=void 0),h=e}}(),S=function(a){var b=function(a,b,c,d){var e=this;this.root=a,this.keypath=b,this.callback=c,this.defer=d.defer,this.debug=d.debug,this.proxy={update:function(){e.reallyUpdate()}},this.priority=0,this.context=d&&d.context?d.context:a};return b.prototype={init:function(a){a!==!1?this.update():this.value=this.root.get(this.keypath)},update:function(){return this.defer&&this.ready?(this.root._deferred.observers.push(this.proxy),void 0):(this.reallyUpdate(),void 0)},reallyUpdate:function(){var b,c;if(b=this.value,c=this.root.get(this.keypath),this.value=c,!this.updating){if(this.updating=!0,!a(c,b)||!this.ready)try{this.callback.call(this.context,c,b,this.keypath)}catch(d){if(this.debug||this.root.debug)throw d}this.updating=!1}}},b}(x),T=function(){return function(a,b){var c,d,e,f,g,h,i;for(c=b.split("."),f=[],h=function(b){var c,d;c=a._wrapped[b]?a._wrapped[b].get():a.get(b);for(d in c)g.push(b+"."+d)},i=function(a){return a+"."+d};d=c.shift();)"*"===d?(g=[],f.forEach(h),f=g):f[0]?f=f.map(i):f[0]=d;return e={},f.forEach(function(b){e[b]=a.get(b)}),e}}(),U=function(a,b){var c,d=/\*/;return c=function(a,b,c,d){this.root=a,this.callback=c,this.defer=d.defer,this.debug=d.debug,this.keypath=b,this.regex=new RegExp("^"+b.replace(/\./g,"\\.").replace(/\*/g,"[^\\.]+")+"$"),this.values={},this.defer&&(this.proxies=[]),this.priority="pattern",this.context=d&&d.context?d.context:a},c.prototype={init:function(a){var c,d;if(c=b(this.root,this.keypath),a!==!1)for(d in c)c.hasOwnProperty(d)&&this.update(d);else this.values=c},update:function(a){var c;{if(!d.test(a))return this.defer&&this.ready?(this.root._deferred.observers.push(this.getProxy(a)),void 0):(this.reallyUpdate(a),void 0);c=b(this.root,a);for(a in c)c.hasOwnProperty(a)&&this.update(a)}},reallyUpdate:function(b){var c=this.root.get(b);if(this.updating)return this.values[b]=c,void 0;if(this.updating=!0,!a(c,this.values[b])||!this.ready){try{this.callback.call(this.context,c,this.values[b],b)}catch(d){if(this.debug||this.root.debug)throw d}this.values[b]=c}this.updating=!1},getProxy:function(a){var b=this;return this.proxies[a]||(this.proxies[a]={update:function(){b.reallyUpdate(a)}}),this.proxies[a]}},c}(x,T),V=function(a,b,c,d,e){var f=/\*/,g={};return function(h,i,j,k){var l,m;return i=a(i),k=k||g,f.test(i)?(l=new e(h,i,j,k),h._patternObservers.push(l),m=!0):l=new d(h,i,j,k),b(l),l.init(k.init),l.ready=!0,{cancel:function(){var a;m&&(a=h._patternObservers.indexOf(l),-1!==a&&h._patternObservers.splice(a,1)),c(l)}}}}(i,Q,R,S,U),W=function(a,b){return function(c,d,e){var f,g=[];if(a(c)){e=d;for(f in c)c.hasOwnProperty(f)&&(d=c[f],g[g.length]=b(this,f,d,e));return{cancel:function(){for(;g.length;)g.pop().cancel()}}}return b(this,c,d,e)}}(w,V),X=function(){return function(a){var b,c,d,e=this._subs[a];if(e)for(b=Array.prototype.slice.call(arguments,1),c=0,d=e.length;d>c;c+=1)e[c].apply(this,b)}}(),Y=function(){return function(a){return this.el?this.fragment.find(a):null}}(),Z=function(a,b){var c,d,e,f,g,h,i,j;if(a){for(c=b("div"),d=["matches","matchesSelector"],g=["o","ms","moz","webkit"],j=function(a){return function(b,c){return b[a](c)}},h=d.length;h--;){if(e=d[h],c[e])return j(e);for(i=g.length;i--;)if(f=g[h]+e.substr(0,1).toUpperCase()+e.substring(1),c[f])return j(f)}return function(a,b){var c,d;for(c=(a.parentNode||a.document).querySelectorAll(b),d=c.length;d--;)if(c[d]===a)return!0;return!1}}}(f,e),$=function(a){return function(b,c){var d=this._isComponentQuery?!this.selector||b.name===this.selector:a(b.node,this.selector);return d?(this.push(b.node||b.instance),c||this._makeDirty(),!0):void 0}}(Z),_=function(){return function(){var a,b,c;a=this._root[this._isComponentQuery?"liveComponentQueries":"liveQueries"],b=this.selector,c=a.indexOf(b),-1!==c&&(a.splice(c,1),a[b]=null)}}(),ab=function(){function a(a){var b;return(b=a.parentFragment)?b.owner:a.component&&(b=a.component.parentFragment)?b.owner:void 0}function b(b){var c,d;for(c=[b],d=a(b);d;)c.push(d),d=a(d);return c}return function(a,c){var d,e,f,g,h,i,j,k,l,m;for(d=b(a.component||a._ractive.proxy),e=b(c.component||c._ractive.proxy),f=d[d.length-1],g=e[e.length-1];f&&f===g;)d.pop(),e.pop(),h=f,f=d[d.length-1],g=e[e.length-1];if(f=f.component||f,g=g.component||g,l=f.parentFragment,m=g.parentFragment,l===m)return i=l.items.indexOf(f),j=m.items.indexOf(g),i-j||d.length-e.length;if(k=h.fragments)return i=k.indexOf(l),j=k.indexOf(m),i-j||d.length-e.length;throw new Error("An unexpected condition was met while comparing the position of two components. Please file an issue at https://github.com/RactiveJS/Ractive/issues - thanks!")}}(),bb=function(a){return function(b,c){var d;return b.compareDocumentPosition?(d=b.compareDocumentPosition(c),2&d?1:-1):a(b,c)}}(ab),cb=function(a,b){return function(){this.sort(this._isComponentQuery?b:a),this._dirty=!1}}(bb,ab),db=function(){return function(){this._dirty||(this._root._deferred.liveQueries.push(this),this._dirty=!0)}}(),eb=function(){return function(a){var b=this.indexOf(this._isComponentQuery?a.instance:a.node);-1!==b&&this.splice(b,1)}}(),fb=function(a,b,c,d,e,f){return function(g,h,i,j){var k;return k=[],a(k,{selector:{value:h},live:{value:i},_isComponentQuery:{value:j},_test:{value:b}}),i?(a(k,{cancel:{value:c},_root:{value:g},_sort:{value:d},_makeDirty:{value:e},_remove:{value:f},_dirty:{value:!1,writable:!0}}),k):k}}(h,$,_,cb,db,eb),gb=function(a,b,c,d){return function(a,b){var c,e;return this.el?(b=b||{},c=this._liveQueries,(e=c[a])?b&&b.live?e:e.slice():(e=d(this,a,!!b.live,!1),e.live&&(c.push(a),c[a]=e),this.fragment.findAll(a,e),e)):[]}}(I,Z,h,fb),hb=function(){return function(a){return this.fragment.findComponent(a)}}(),ib=function(a,b,c,d){return function(a,b){var c,e;return b=b||{},c=this._liveComponentQueries,(e=c[a])?b&&b.live?e:e.slice():(e=d(this,a,!!b.live,!0),e.live&&(c.push(a),c[a]=e),this.fragment.findAllComponents(a,e),e)}}(I,Z,h,fb),jb=function(){return function(a){var b;return"undefined"!=typeof window&&document&&a?a.nodeType?a:"string"==typeof a&&(b=document.getElementById(a),!b&&document.querySelector&&(b=document.querySelector(a)),b&&b.nodeType)?b:a[0]&&a[0].nodeType?a[0]:null:null}}(),kb=function(a,b){return function(c,d){var e,f,g,h,i;if(c.owner=d.owner,g=c.owner.parentFragment,c.root=d.root,c.pNode=d.pNode,c.contextStack=d.contextStack||[],c.owner.type===a.SECTION&&(c.index=d.index),g&&(h=g.indexRefs)){c.indexRefs=b(null);for(i in h)c.indexRefs[i]=h[i]}for(c.priority=g?g.priority+1:1,d.indexRef&&(c.indexRefs||(c.indexRefs={}),c.indexRefs[d.indexRef]=d.index),c.items=[],e=d.descriptor?d.descriptor.length:0,f=0;e>f;f+=1)c.items[c.items.length]=c.createItem({parentFragment:c,descriptor:d.descriptor[f],index:f})}}(k,c),lb=function(a){var b={};return function(c,d,e){var f,g=[];if(c)for(f=b[d]||(b[d]=a(d)),f.innerHTML=c;f.firstChild;)g[g.length]=f.firstChild,e.appendChild(f.firstChild);return g}}(e),mb=function(a){var b,c,d;return c=/</g,d=/>/g,b=function(b,c){this.type=a.TEXT,this.descriptor=b.descriptor,c&&(this.node=document.createTextNode(b.descriptor),c.appendChild(this.node))},b.prototype={detach:function(){return this.node.parentNode.removeChild(this.node),this.node},teardown:function(a){a&&this.detach()},firstNode:function(){return this.node},toString:function(){return(""+this.descriptor).replace(c,"&lt;").replace(d,"&gt;")}},b}(k),nb=function(a){return function(b){if(b.keypath)a(b);else{var c=b.root._pendingResolution.indexOf(b);-1!==c&&b.root._pendingResolution.splice(c,1)}}}(R),ob=function(a,b,c,d,e){function f(a,b,d){var e,f,g;if(!h.test(a.toString()))return c(a,"_nowrap",{value:!0}),a;if(!a["_"+b._guid]){c(a,"_"+b._guid,{value:function(){var c,d,e,g;if(c=b._captured,c||(b._captured=[]),d=a.apply(b,arguments),b._captured.length)for(e=f.length;e--;)g=f[e],g.updateSoftDependencies(b._captured);return b._captured=c,d},writable:!0});for(e in a)a.hasOwnProperty(e)&&(a["_"+b._guid][e]=a[e]);a["_"+b._guid+"_evaluators"]=[]}return f=a["_"+b._guid+"_evaluators"],g=f.indexOf(d),-1===g&&f.push(d),a["_"+b._guid]}var g,h;return h=/this/,g=function(b,c,e,g,h){var i;this.evaluator=e,this.keypath=c,this.root=b,this.argNum=g,this.type=a.REFERENCE,this.priority=h,i=b.get(c),"function"==typeof i&&(i=f(i,b,e)),this.value=e.values[g]=i,d(this)},g.prototype={update:function(){var a=this.root.get(this.keypath);"function"!=typeof a||a._nowrap||(a=f(a,this.root,this.evaluator)),b(a,this.value)||(this.evaluator.values[this.argNum]=a,this.evaluator.bubble(),this.value=a)},teardown:function(){e(this)}},g}(k,x,g,Q,R),pb=function(a,b,c){var d=function(a,c,d){this.root=a,this.keypath=c,this.priority=d.priority,this.evaluator=d,b(this)};return d.prototype={update:function(){var b=this.root.get(this.keypath);a(b,this.value)||(this.evaluator.bubble(),this.value=b)},teardown:function(){c(this)}},d}(x,Q,R),qb=function(a,b,c,d,e,f,g,h,i){function j(a,b){var c,d;if(a=a.replace(/\$\{([0-9]+)\}/g,"_$1"),l[a])return l[a];for(d=[];b--;)d[b]="_"+b;return c=new Function(d.join(","),"return("+a+")"),l[a]=c,c}var k,l={};return k=function(a,b,c,d,e){var f,g;for(this.root=a,this.keypath=b,this.priority=e,this.fn=j(c,d.length),this.values=[],this.refs=[],f=d.length;f--;)(g=d[f])?g[0]?this.values[f]=g[1]:this.refs[this.refs.length]=new h(a,g[1],this,f,e):this.values[f]=void 0;this.selfUpdating=this.refs.length<=1,this.update()},k.prototype={bubble:function(){this.selfUpdating?this.update():this.deferred||(this.root._deferred.evals.push(this),this.deferred=!0)
},update:function(){var b;if(this.evaluating)return this;this.evaluating=!0;try{b=this.fn.apply(null,this.values)}catch(e){if(this.root.debug)throw e;b=void 0}return a(b,this.value)||(c(this.root,this.keypath),this.root._cache[this.keypath]=b,g(this.root,this.keypath,b,!0),this.value=b,d(this.root,this.keypath)),this.evaluating=!1,this},teardown:function(){for(;this.refs.length;)this.refs.pop().teardown();c(this.root,this.keypath),this.root._evaluators[this.keypath]=null},refresh:function(){this.selfUpdating||(this.deferred=!0);for(var a=this.refs.length;a--;)this.refs[a].update();this.deferred&&(this.update(),this.deferred=!1)},updateSoftDependencies:function(a){var b,c,d;for(this.softRefs||(this.softRefs=[]),b=this.softRefs.length;b--;)d=this.softRefs[b],a[d.keypath]||(this.softRefs.splice(b,1),this.softRefs[d.keypath]=!1,d.teardown());for(b=a.length;b--;)c=a[b],this.softRefs[c]||(d=new i(this.root,c,this),this.softRefs[this.softRefs.length]=d,this.softRefs[c]=!0);this.selfUpdating=this.refs.length+this.softRefs.length<=1}},k}(x,g,m,r,Q,R,u,ob,pb),rb=function(a,b){var c=function(b,c,d,e){var f,g;g=this.root=b.root,f=a(g,c,d),void 0!==f?b.resolveRef(e,!1,f):(this.ref=c,this.argNum=e,this.resolver=b,this.contextStack=d,g._pendingResolution[g._pendingResolution.length]=this)};return c.prototype={resolve:function(a){this.keypath=a,this.resolver.resolveRef(this.argNum,!1,a)},teardown:function(){this.keypath||b(this)}},c}(y,nb),sb=function(){var a=/^(?:(?:[a-zA-Z$_][a-zA-Z$_0-9]*)|(?:[0-9]|[1-9][0-9]+))$/;return function(b){var c,d,e;for(c=b.split("."),e=c.length;e--;)if(d=c[e],"undefined"===d||!a.test(d))return!1;return!0}}(),tb=function(a,b){return function(c,d){var e,f;return e=c.replace(/\$\{([0-9]+)\}/g,function(a,b){return d[b]?d[b][1]:"undefined"}),f=a(e),b(f)?f:"${"+e.replace(/[\.\[\]]/g,"-")+"}"}}(i,sb),ub=function(a,b){function c(a,b,c){var e,f;if(e=a._depsMap[b])for(f=e.length;f--;)d(a,e[f],c)}function d(a,b,d){var e,f,g,h;for(e=a._deps.length;e--;)if(f=a._deps[e],f&&(g=f[b]))for(h=g.length;h--;)d.push(g[h]);c(a,b,d)}return function(c,e,f){var g,h,i;for(g=[],d(c,e,g),h=g.length;h--;)i=g[h],b(i),i.keypath=i.keypath.replace(e,f),a(i),i.update()}}(Q,R),vb=function(a,b,c,d){var e=function(a){var c,d,e,f,g;if(this.root=a.root,this.mustache=a,this.args=[],this.scouts=[],c=a.descriptor.x,g=a.parentFragment.indexRefs,this.str=c.s,e=this.unresolved=this.args.length=c.r?c.r.length:0,!e)return this.resolved=this.ready=!0,this.bubble(),void 0;for(d=0;e>d;d+=1)f=c.r[d],g&&void 0!==g[f]?this.resolveRef(d,!0,g[f]):this.scouts[this.scouts.length]=new b(this,f,a.contextStack,d);this.ready=!0,this.bubble()};return e.prototype={bubble:function(){var a;this.ready&&(a=this.keypath,this.keypath=c(this.str,this.args),"${"===this.keypath.substr(0,2)&&this.createEvaluator(),a?d(this.root,a,this.keypath):this.mustache.resolve(this.keypath))},teardown:function(){for(;this.scouts.length;)this.scouts.pop().teardown()},resolveRef:function(a,b,c){this.args[a]=[b,c],this.bubble(),this.resolved=!--this.unresolved},createEvaluator:function(){this.root._evaluators[this.keypath]?this.root._evaluators[this.keypath].refresh():this.root._evaluators[this.keypath]=new a(this.root,this.keypath,this.str,this.args,this.mustache.priority)}},e}(qb,rb,tb,ub),wb=function(a,b){return function(c,d){var e,f,g;g=c.parentFragment=d.parentFragment,c.root=g.root,c.contextStack=g.contextStack,c.descriptor=d.descriptor,c.index=d.index||0,c.priority=g.priority,c.type=d.descriptor.t,d.descriptor.r&&(g.indexRefs&&void 0!==g.indexRefs[d.descriptor.r]?(f=g.indexRefs[d.descriptor.r],c.indexRef=d.descriptor.r,c.value=f,c.render(c.value)):(e=a(c.root,d.descriptor.r,c.contextStack),void 0!==e?c.resolve(e):(c.ref=d.descriptor.r,c.root._pendingResolution[c.root._pendingResolution.length]=c))),d.descriptor.x&&(c.expressionResolver=new b(c)),c.descriptor.n&&!c.hasOwnProperty("value")&&c.render(void 0)}}(y,vb),xb=function(a,b,c){return function(d){d!==this.keypath&&(this.registered&&c(this),this.keypath=d,b(this),this.update(),this.root.twoway&&this.parentFragment.owner.type===a.ATTRIBUTE&&this.parentFragment.owner.element.bind(),this.expressionResolver&&this.expressionResolver.resolved&&(this.expressionResolver=null))}}(k,Q,R),yb=function(a){return function(){var b,c;c=this.root.get(this.keypath),(b=this.root._wrapped[this.keypath])&&(c=b.get()),a(c,this.value)||(this.render(c),this.value=c)}}(x),zb=function(a,b,c,d,e){var f,g,h;return g=/</g,h=/>/g,f=function(b,d){this.type=a.INTERPOLATOR,d&&(this.node=document.createTextNode(""),d.appendChild(this.node)),c(this,b)},f.prototype={update:e,resolve:d,detach:function(){return this.node.parentNode.removeChild(this.node),this.node},teardown:function(a){a&&this.detach(),b(this)},render:function(a){this.node&&(this.node.data=void 0==a?"":a)},firstNode:function(){return this.node},toString:function(){var a=void 0!=this.value?""+this.value:"";return a.replace(g,"&lt;").replace(h,"&gt;")}},f}(k,nb,wb,xb,yb),Ab=function(a,b,c){function d(a,b,c){var d,e,f;if(e=b.length,e<a.length)for(f=a.fragments.splice(e,a.length-e);f.length;)f.pop().teardown(!0);else if(e>a.length)for(d=a.length;e>d;d+=1)c.contextStack=a.contextStack.concat(a.keypath+"."+d),c.index=d,a.descriptor.i&&(c.indexRef=a.descriptor.i),a.fragments[d]=a.createFragment(c);a.length=e}function e(a,b,d){var e,f;f=a.fragmentsById||(a.fragmentsById=c(null));for(e in f)void 0===b[e]&&f[e]&&(f[e].teardown(!0),f[e]=null);for(e in b)void 0===b[e]||f[e]||(d.contextStack=a.contextStack.concat(a.keypath+"."+e),d.index=e,a.descriptor.i&&(d.indexRef=a.descriptor.i),f[e]=a.createFragment(d))}function f(a,b){a.length||(b.contextStack=a.contextStack.concat(a.keypath),b.index=0,a.fragments[0]=a.createFragment(b),a.length=1)}function g(b,c,d,e){var f,g,h,i;if(g=a(c)&&0===c.length,f=d?g||!c:c&&!g){if(b.length||(e.contextStack=b.contextStack,e.index=0,b.fragments[0]=b.createFragment(e),b.length=1),b.length>1)for(h=b.fragments.splice(1);i=h.pop();)i.teardown(!0)}else b.length&&(b.teardownFragments(!0),b.length=0)}return function(c,h){var i;return i={descriptor:c.descriptor.f,root:c.root,pNode:c.parentFragment.pNode,owner:c},c.descriptor.n?(g(c,h,!0,i),void 0):(a(h)?d(c,h,i):b(h)?c.descriptor.i?e(c,h,i):f(c,i):g(c,h,!1,i),void 0)}}(l,w,c),Bb=function(a,b,c){function d(b,c,g,h,i,j,k){var l,m,n,o;if(!b.html){for(b.indexRefs&&void 0!==b.indexRefs[c]&&(b.indexRefs[c]=h),l=b.contextStack.length;l--;)n=b.contextStack[l],n.substr(0,j.length)===j&&(b.contextStack[l]=n.replace(j,k));for(l=b.items.length;l--;)switch(m=b.items[l],m.type){case a.ELEMENT:e(m,c,g,h,i,j,k);break;case a.PARTIAL:d(m.fragment,c,g,h,i,j,k);break;case a.COMPONENT:d(m.instance.fragment,c,g,h,i,j,k),(o=b.root._liveComponentQueries[m.name])&&o._makeDirty();break;case a.SECTION:case a.INTERPOLATOR:case a.TRIPLE:f(m,c,g,h,i,j,k)}}}function e(a,b,c,e,f,g,h){var i,j,k,l,m,n,o,p,q,r;for(i=a.attributes.length;i--;)j=a.attributes[i],j.fragment&&(d(j.fragment,b,c,e,f,g,h),j.twoway&&j.updateBindings());if(k=a.node._ractive){k.keypath.substr(0,g.length)===g&&(k.keypath=k.keypath.replace(g,h)),void 0!==b&&(k.index[b]=e);for(l in k.events)for(m=k.events[l].proxies,i=m.length;i--;)n=m[i],"object"==typeof n.n&&d(n.a,b,c,e,f,g,h),n.d&&d(n.d,b,c,e,f,g,h);(o=k.binding)&&o.keypath.substr(0,g.length)===g&&(p=k.root._twowayBindings[o.keypath],p.splice(p.indexOf(o),1),o.keypath=o.keypath.replace(g,h),p=k.root._twowayBindings[o.keypath]||(k.root._twowayBindings[o.keypath]=[]),p.push(o))}if(a.fragment&&d(a.fragment,b,c,e,f,g,h),q=a.liveQueries)for(r=a.root,i=q.length;i--;)r._liveQueries[q[i]]._makeDirty()}function f(a,b,e,f,g,h,i){var j;if(a.descriptor.x&&(a.expressionResolver&&a.expressionResolver.teardown(),a.expressionResolver=new c(a)),a.keypath?a.keypath.substr(0,h.length)===h&&a.resolve(a.keypath.replace(h,i)):a.indexRef===b&&(a.value=f,a.render(f)),a.fragments)for(j=a.fragments.length;j--;)d(a.fragments[j],b,e,f,g,h,i)}return d}(k,R,vb),Cb=function(a,b,c){return function(a,d,e,f,g){var h,i,j,k,l,m,n;for(j=d.descriptor.i,h=e;f>h;h+=1)i=d.fragments[h],k=h-g,l=h,m=d.keypath+"."+(h-g),n=d.keypath+"."+h,i.index+=g,b(i,j,k,l,g,m,n);c(a)}}(k,Bb,o),Db=function(a){return function(b){var c,d,e,f,g,h,i,j,k,l,m=this;if(c=this.parentFragment,h=[],b.forEach(function(b,c){var f,g,j;return b===c?(h[b]=m.fragments[c],void 0):(void 0===d&&(d=c),-1===b?((i||(i=[])).push(m.fragments[c]),void 0):(f=b-c,g=m.keypath+"."+c,j=m.keypath+"."+b,a(m.fragments[c],m.descriptor.i,c,b,f,g,j),h[b]=m.fragments[c],e=!0,void 0))}),i)for(;k=i.pop();)k.teardown(!0);if(void 0===d&&(d=this.length),g=this.root.get(this.keypath).length,g!==d){for(j={descriptor:this.descriptor.f,root:this.root,pNode:c.pNode,owner:this},this.descriptor.i&&(j.indexRef=this.descriptor.i),f=d;g>f;f+=1)(k=h[f])?this.docFrag.appendChild(k.detach(!1)):(j.contextStack=this.contextStack.concat(this.keypath+"."+f),j.index=f,k=this.createFragment(j)),this.fragments[f]=k;l=c.findNextNode(this),c.pNode.insertBefore(this.docFrag,l),this.length=g}}}(Bb),Eb=function(){return[]}(),Fb=function(a,b,c,d,e,f,g,h,i,j,k){var l,m;return k.push(function(){m=k.DomFragment}),l=function(b,d){this.type=a.SECTION,this.inverted=!!b.descriptor.n,this.fragments=[],this.length=0,d&&(this.docFrag=document.createDocumentFragment()),this.initialising=!0,c(this,b),d&&d.appendChild(this.docFrag),this.initialising=!1},l.prototype={update:d,resolve:e,smartUpdate:function(a,b){var c;("push"===a||"unshift"===a||"splice"===a)&&(c={descriptor:this.descriptor.f,root:this.root,pNode:this.parentFragment.pNode,owner:this},this.descriptor.i&&(c.indexRef=this.descriptor.i)),this[a]&&(this.rendering=!0,this[a](c,b),this.rendering=!1)},pop:function(){this.length&&(this.fragments.pop().teardown(!0),this.length-=1)},push:function(a,b){var c,d,e;for(c=this.length,d=c+b.length,e=c;d>e;e+=1)a.contextStack=this.contextStack.concat(this.keypath+"."+e),a.index=e,this.fragments[e]=this.createFragment(a);this.length+=b.length,this.parentFragment.pNode.insertBefore(this.docFrag,this.parentFragment.findNextNode(this))},shift:function(){this.splice(null,[0,1])},unshift:function(a,b){this.splice(a,[0,0].concat(new Array(b.length)))},splice:function(a,b){var c,d,e,f,g,i,j,k,l;if(b.length&&(i=+(b[0]<0?this.length+b[0]:b[0]),d=Math.max(0,b.length-2),e=void 0!==b[1]?b[1]:this.length-i,e=Math.min(e,this.length-i),f=d-e)){if(0>f){for(j=i-f,g=i;j>g;g+=1)this.fragments[g].teardown(!0);this.fragments.splice(i,-f)}else{for(j=i+f,c=this.fragments[i]?this.fragments[i].firstNode():this.parentFragment.findNextNode(this),k=[i,0].concat(new Array(f)),this.fragments.splice.apply(this.fragments,k),g=i;j>g;g+=1)a.contextStack=this.contextStack.concat(this.keypath+"."+g),a.index=g,this.fragments[g]=this.createFragment(a);this.parentFragment.pNode.insertBefore(this.docFrag,c)}this.length+=f,l=i+d,h(this.root,this,l,this.length,f)}},merge:i,detach:function(){var a,b;for(b=this.fragments.length,a=0;b>a;a+=1)this.docFrag.appendChild(this.fragments[a].detach());return this.docFrag},teardown:function(a){this.teardownFragments(a),j(this)},firstNode:function(){return this.fragments[0]?this.fragments[0].firstNode():this.parentFragment.findNextNode(this)},findNextNode:function(a){return this.fragments[a.index+1]?this.fragments[a.index+1].firstNode():this.parentFragment.findNextNode(this)},teardownFragments:function(a){for(var b,c;c=this.fragments.shift();)c.teardown(a);if(this.fragmentsById)for(b in this.fragmentsById)this.fragments[b]&&(this.fragmentsById[b].teardown(a),this.fragmentsById[b]=null)},render:function(a){var c,d;(d=this.root._wrapped[this.keypath])&&(a=d.get()),this.rendering||(this.rendering=!0,f(this,a),this.rendering=!1,(!this.docFrag||this.docFrag.childNodes.length)&&!this.initialising&&b&&(c=this.parentFragment.findNextNode(this),c&&c.parentNode===this.parentFragment.pNode?this.parentFragment.pNode.insertBefore(this.docFrag,c):this.parentFragment.pNode.appendChild(this.docFrag)))},createFragment:function(a){var b=new m(a);return this.docFrag&&this.docFrag.appendChild(b.docFrag),b},toString:function(){var a,b,c,d;for(a="",b=0,d=this.length,b=0;d>b;b+=1)a+=this.fragments[b].toString();if(this.fragmentsById)for(c in this.fragmentsById)this.fragmentsById[c]&&(a+=this.fragmentsById[c].toString());return a},find:function(a){var b,c,d;for(c=this.fragments.length,b=0;c>b;b+=1)if(d=this.fragments[b].find(a))return d;return null},findAll:function(a,b){var c,d;for(d=this.fragments.length,c=0;d>c;c+=1)this.fragments[c].findAll(a,b)},findComponent:function(a){var b,c,d;for(c=this.fragments.length,b=0;c>b;b+=1)if(d=this.fragments[b].findComponent(a))return d;return null},findAllComponents:function(a,b){var c,d;for(d=this.fragments.length,c=0;d>c;c+=1)this.fragments[c].findAllComponents(a,b)}},l}(k,f,wb,yb,xb,Ab,Bb,Cb,Db,nb,Eb),Gb=function(a,b,c,d,e,f,g){var h=function(b,d){this.type=a.TRIPLE,d&&(this.nodes=[],this.docFrag=document.createDocumentFragment()),this.initialising=!0,c(this,b),d&&d.appendChild(this.docFrag),this.initialising=!1};return h.prototype={update:d,resolve:e,detach:function(){for(var a=this.nodes.length;a--;)this.docFrag.appendChild(this.nodes[a]);return this.docFrag},teardown:function(a){a&&(this.detach(),this.docFrag=this.nodes=null),g(this)},firstNode:function(){return this.nodes[0]?this.nodes[0]:this.parentFragment.findNextNode(this)},render:function(a){var b,c;if(this.nodes){for(;this.nodes.length;)b=this.nodes.pop(),b.parentNode.removeChild(b);if(!a)return this.nodes=[],void 0;c=this.parentFragment.pNode,this.nodes=f(a,c.tagName,this.docFrag),this.initialising||c.insertBefore(this.docFrag,this.parentFragment.findNextNode(this))}},toString:function(){return void 0!=this.value?this.value:""},find:function(a){var c,d,e,f;for(d=this.nodes.length,c=0;d>c;c+=1)if(e=this.nodes[c],1===e.nodeType){if(b(e,a))return e;if(f=e.querySelector(a))return f}return null},findAll:function(a,c){var d,e,f,g,h,i;for(e=this.nodes.length,d=0;e>d;d+=1)if(f=this.nodes[d],1===f.nodeType&&(b(f,a)&&c.push(f),g=f.querySelectorAll(a)))for(h=g.length,i=0;h>i;i+=1)c.push(g[i])}},h}(k,Z,wb,yb,xb,lb,nb),Hb=function(a){return function(b,c){return b.a&&b.a.xmlns?b.a.xmlns:"svg"===b.e?a.svg:c.namespaceURI||a.html}}(d),Ib=function(){var a,b,c,d;return a="altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath vkern".split(" "),b="attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits contentScriptType contentStyleType diffuseConstant edgeMode externalResourcesRequired filterRes filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan".split(" "),c=function(a){for(var b={},c=a.length;c--;)b[a[c].toLowerCase()]=a[c];return b},d=c(a.concat(b)),function(a){var b=a.toLowerCase();return d[b]||b}}(),Jb=function(a,b){return function(c,d){var e,f;if(e=d.indexOf(":"),-1===e||(f=d.substr(0,e),"xmlns"===f))c.name=c.element.namespace!==a.html?b(d):d,c.lcName=c.name.toLowerCase();else if(d=d.substring(e+1),c.name=b(d),c.lcName=c.name.toLowerCase(),c.namespace=a[f.toLowerCase()],!c.namespace)throw'Unknown namespace ("'+f+'")'}}(d,Ib),Kb=function(a){return function(b,c){var d,e=null===c.value?"":c.value;(d=c.pNode)&&(b.namespace?d.setAttributeNS(b.namespace,c.name,e):"style"===c.name&&d.style.setAttribute?d.style.setAttribute("cssText",e):"class"!==c.name||d.namespaceURI&&d.namespaceURI!==a.html?d.setAttribute(c.name,e):d.className=e,"id"===b.name&&(c.root.nodes[c.value]=d),"value"===b.name&&(d._ractive.value=c.value)),b.value=c.value}}(d),Lb=function(a){var b={"accept-charset":"acceptCharset",accesskey:"accessKey",bgcolor:"bgColor","class":"className",codebase:"codeBase",colspan:"colSpan",contenteditable:"contentEditable",datetime:"dateTime",dirname:"dirName","for":"htmlFor","http-equiv":"httpEquiv",ismap:"isMap",maxlength:"maxLength",novalidate:"noValidate",pubdate:"pubDate",readonly:"readOnly",rowspan:"rowSpan",tabindex:"tabIndex",usemap:"useMap"};return function(c,d){var e;!c.pNode||c.namespace||d.pNode.namespaceURI&&d.pNode.namespaceURI!==a.html||(e=b[c.name]||c.name,void 0!==d.pNode[e]&&(c.propertyName=e),("boolean"==typeof d.pNode[e]||"value"===e)&&(c.useProperty=!0))}}(d),Mb=function(a,b,c,d){var e,f,g,h,i,j,k,l,m,n,o,p,q,r;return e=function(){var a,b,c,d=this.pNode;return this.fragment?(a=f(this))?(this.interpolator=a,this.keypath=a.keypath||a.descriptor.r,(b=i(this))?(d._ractive.binding=this.element.binding=b,this.twoway=!0,c=this.root._twowayBindings[this.keypath]||(this.root._twowayBindings[this.keypath]=[]),c[c.length]=b,!0):!1):!1:!1},g=function(){this._ractive.binding.update()},h=function(){var a=this._ractive.root.get(this._ractive.binding.keypath);this.value=void 0==a?"":a},f=function(c){var d,e;return 1!==c.fragment.items.length?null:(d=c.fragment.items[0],d.type!==a.INTERPOLATOR?null:d.keypath||d.ref?d.keypath&&"${"===d.keypath.substr(0,2)?(e="You cannot set up two-way binding against an expression "+d.keypath,c.root.debug&&b(e),null):d:null)},i=function(a){var c=a.pNode;if("SELECT"===c.tagName)return c.multiple?new k(a,c):new l(a,c);if("checkbox"===c.type||"radio"===c.type){if("name"===a.propertyName){if("checkbox"===c.type)return new n(a,c);if("radio"===c.type)return new m(a,c)}return"checked"===a.propertyName?new o(a,c):null}return"value"!==a.lcName&&b("This is... odd"),"file"===c.type?new p(a,c):c.getAttribute("contenteditable")?new q(a,c):new r(a,c)},k=function(a,b){var c;j(this,a,b),b.addEventListener("change",g,!1),c=this.root.get(this.keypath),void 0===c&&this.update()},k.prototype={value:function(){var a,b,c,d;for(a=[],b=this.node.options,d=b.length,c=0;d>c;c+=1)b[c].selected&&(a[a.length]=b[c]._ractive.value);return a},update:function(){var a,b,d;return a=this.attr,b=a.value,d=this.value(),void 0!==b&&c(d,b)||(a.receiving=!0,a.value=d,this.root.set(this.keypath,d),a.receiving=!1),this},deferUpdate:function(){this.deferred!==!0&&(this.root._deferred.attrs.push(this),this.deferred=!0)},teardown:function(){this.node.removeEventListener("change",g,!1)}},l=function(a,b){var c;j(this,a,b),b.addEventListener("change",g,!1),c=this.root.get(this.keypath),void 0===c&&this.update()},l.prototype={value:function(){var a,b,c;for(a=this.node.options,c=a.length,b=0;c>b;b+=1)if(a[b].selected)return a[b]._ractive.value},update:function(){var a=this.value();return this.attr.receiving=!0,this.attr.value=a,this.root.set(this.keypath,a),this.attr.receiving=!1,this},deferUpdate:function(){this.deferred!==!0&&(this.root._deferred.attrs.push(this),this.deferred=!0)},teardown:function(){this.node.removeEventListener("change",g,!1)}},m=function(a,b){var c;this.radioName=!0,j(this,a,b),b.name="{{"+a.keypath+"}}",b.addEventListener("change",g,!1),b.attachEvent&&b.addEventListener("click",g,!1),c=this.root.get(this.keypath),void 0!==c?b.checked=c==b._ractive.value:this.root._deferred.radios.push(this)},m.prototype={value:function(){return this.node._ractive?this.node._ractive.value:this.node.value},update:function(){var a=this.node;a.checked&&(this.attr.receiving=!0,this.root.set(this.keypath,this.value()),this.attr.receiving=!1)},teardown:function(){this.node.removeEventListener("change",g,!1),this.node.removeEventListener("click",g,!1)}},n=function(a,b){var c,d;this.checkboxName=!0,j(this,a,b),b.name="{{"+this.keypath+"}}",b.addEventListener("change",g,!1),b.attachEvent&&b.addEventListener("click",g,!1),c=this.root.get(this.keypath),void 0!==c?(d=-1!==c.indexOf(b._ractive.value),b.checked=d):-1===this.root._deferred.checkboxes.indexOf(this.keypath)&&this.root._deferred.checkboxes.push(this.keypath)},n.prototype={changed:function(){return this.node.checked!==!!this.checked},update:function(){this.checked=this.node.checked,this.attr.receiving=!0,this.root.set(this.keypath,d(this.root,this.keypath)),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",g,!1),this.node.removeEventListener("click",g,!1)}},o=function(a,b){j(this,a,b),b.addEventListener("change",g,!1),b.attachEvent&&b.addEventListener("click",g,!1)},o.prototype={value:function(){return this.node.checked},update:function(){this.attr.receiving=!0,this.root.set(this.keypath,this.value()),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",g,!1),this.node.removeEventListener("click",g,!1)}},p=function(a,b){j(this,a,b),b.addEventListener("change",g,!1)},p.prototype={value:function(){return this.attr.pNode.files},update:function(){this.attr.root.set(this.attr.keypath,this.value())},teardown:function(){this.node.removeEventListener("change",g,!1)}},q=function(a,b){j(this,a,b),b.addEventListener("change",g,!1),this.root.lazy||(b.addEventListener("input",g,!1),b.attachEvent&&b.addEventListener("keyup",g,!1))},q.prototype={update:function(){this.attr.receiving=!0,this.root.set(this.keypath,this.node.innerHTML),this.attr.receiving=!1},teardown:function(){this.node.removeEventListener("change",g,!1),this.node.removeEventListener("input",g,!1),this.node.removeEventListener("keyup",g,!1)}},r=function(a,b){j(this,a,b),b.addEventListener("change",g,!1),this.root.lazy||(b.addEventListener("input",g,!1),b.attachEvent&&b.addEventListener("keyup",g,!1)),this.node.addEventListener("blur",h,!1)},r.prototype={value:function(){var a=this.attr.pNode.value;return+a+""===a&&-1===a.indexOf("e")&&(a=+a),a},update:function(){var a=this.attr,b=this.value();a.receiving=!0,a.root.set(a.keypath,b),a.receiving=!1},teardown:function(){this.node.removeEventListener("change",g,!1),this.node.removeEventListener("input",g,!1),this.node.removeEventListener("keyup",g,!1),this.node.removeEventListener("blur",h,!1)}},j=function(a,b,c){a.attr=b,a.node=c,a.root=b.root,a.keypath=b.keypath},e}(k,I,E,n),Nb=function(a,b){var c,d,e,f,g,h,i,j,k,l,m,n;return c=function(){var a;if(!this.ready)return this;if(a=this.pNode,"SELECT"===a.tagName&&"value"===this.lcName)return this.update=e,this.deferredUpdate=f,this.update();if(this.isFileInputValue)return this.update=d,this;if(this.twoway&&"name"===this.lcName){if("radio"===a.type)return this.update=i,this.update();if("checkbox"===a.type)return this.update=j,this.update()}return"style"===this.lcName&&a.style.setAttribute?(this.update=k,this.update()):"class"!==this.lcName||a.namespaceURI&&a.namespaceURI!==b.html?a.getAttribute("contenteditable")&&"value"===this.lcName?(this.update=m,this.update()):(this.update=n,this.update()):(this.update=l,this.update())},d=function(){return this},f=function(){this.deferredUpdate=this.pNode.multiple?h:g,this.deferredUpdate()},e=function(){return this.root._deferred.selectValues.push(this),this},g=function(){var a,b,c,d=this.fragment.getValue();for(this.value=this.pNode._ractive.value=d,a=this.pNode.options,c=a.length;c--;)if(b=a[c],b._ractive.value==d)return b.selected=!0,this;return this},h=function(){var b,c,d=this.fragment.getValue();for(a(d)||(d=[d]),b=this.pNode.options,c=b.length;c--;)b[c].selected=-1!==d.indexOf(b[c]._ractive.value);return this.value=d,this},i=function(){var a,b;return a=this.pNode,b=this.fragment.getValue(),a.checked=b==a._ractive.value,this},j=function(){var b,c;return b=this.pNode,c=this.fragment.getValue(),a(c)?(b.checked=-1!==c.indexOf(b._ractive.value),this):(b.checked=c==b._ractive.value,this)},k=function(){var a,b;return a=this.pNode,b=this.fragment.getValue(),void 0===b&&(b=""),b!==this.value&&(a.style.setAttribute("cssText",b),this.value=b),this},l=function(){var a,b;return a=this.pNode,b=this.fragment.getValue(),void 0===b&&(b=""),b!==this.value&&(a.className=b,this.value=b),this},m=function(){var a,b;return a=this.pNode,b=this.fragment.getValue(),void 0===b&&(b=""),b!==this.value&&(this.receiving||(a.innerHTML=b),this.value=b),this},n=function(){var a,b;if(a=this.pNode,b=this.fragment.getValue(),this.isValueAttribute&&(a._ractive.value=b),void 0===b&&(b=""),b!==this.value){if(this.useProperty)return this.receiving||(a[this.propertyName]=b),this.value=b,this;if(this.namespace)return a.setAttributeNS(this.namespace,this.name,b),this.value=b,this;"id"===this.lcName&&(void 0!==this.value&&(this.root.nodes[this.value]=void 0),this.root.nodes[b]=a),a.setAttribute(this.name,b),this.value=b}return this},c}(l,d),Ob=function(){return function(a){var b;return b=this.str.substr(this.pos,a.length),b===a?(this.pos+=a.length,a):null}}(),Pb=function(){var a=/^\s+/;return function(){var b=a.exec(this.remaining());return b?(this.pos+=b[0].length,b[0]):null}}(),Qb=function(){return function(a){return function(b){var c=a.exec(b.str.substring(b.pos));return c?(b.pos+=c[0].length,c[1]||c[0]):null}}}(),Rb=function(){function a(a){var b;return a.getStringMatch("\\")?(b=a.str.charAt(a.pos),a.pos+=1,b):null}return function(b){var c,d="";for(c=a(b);c;)d+=c,c=a(b);return d||null}}(),Sb=function(a,b){var c=a(/^[^\\"]+/),d=a(/^[^\\']+/);return function e(a,f){var g,h,i,j,k,l;if(g=a.pos,h="",l=f?d:c,i=b(a),i&&(h+=i),j=l(a),j&&(h+=j),!h)return"";for(k=e(a,f);""!==k;)h+=k;return h}}(Qb,Rb),Tb=function(a,b){return function(c){var d,e;return d=c.pos,c.getStringMatch('"')?(e=b(c,!1),c.getStringMatch('"')?{t:a.STRING_LITERAL,v:e}:(c.pos=d,null)):c.getStringMatch("'")?(e=b(c,!0),c.getStringMatch("'")?{t:a.STRING_LITERAL,v:e}:(c.pos=d,null)):null}}(k,Sb),Ub=function(a,b){var c=b(/^(?:[+-]?)(?:(?:(?:0|[1-9]\d*)?\.\d+)|(?:(?:0|[1-9]\d*)\.)|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?/);return function(b){var d;return(d=c(b))?{t:a.NUMBER_LITERAL,v:d}:null}}(k,Qb),Vb=function(a){return a(/^[a-zA-Z_$][a-zA-Z_$0-9]*/)}(Qb),Wb=function(a,b,c){var d=/^[a-zA-Z_$][a-zA-Z_$0-9]*$/;return function(e){var f;return(f=a(e))?d.test(f.v)?f.v:'"'+f.v.replace(/"/g,'\\"')+'"':(f=b(e))?f.v:(f=c(e))?f:void 0}}(Tb,Ub,Vb),Xb=function(a,b,c,d){function e(a){var b,c,e;return a.allowWhitespace(),(b=d(a))?(e={key:b},a.allowWhitespace(),a.getStringMatch(":")?(a.allowWhitespace(),(c=a.getToken())?(e.value=c.v,e):null):null):null}var f,g,h,i,j,k;return g={"true":!0,"false":!1,undefined:void 0,"null":null},h=new RegExp("^(?:"+Object.keys(g).join("|")+")"),i=/^(?:[+-]?)(?:(?:(?:0|[1-9]\d*)?\.\d+)|(?:(?:0|[1-9]\d*)\.)|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?/,j=/\$\{([^\}]+)\}/g,k=/^\$\{([^\}]+)\}/,f=function(a,b){this.str=a,this.values=b,this.pos=0,this.result=this.getToken()},f.prototype={remaining:function(){return this.str.substring(this.pos)},getStringMatch:a,getToken:function(){return this.allowWhitespace(),this.getPlaceholder()||this.getSpecial()||this.getNumber()||this.getString()||this.getObject()||this.getArray()},getPlaceholder:function(){var a;return this.values?(a=k.exec(this.remaining()))&&this.values.hasOwnProperty(a[1])?(this.pos+=a[0].length,{v:this.values[a[1]]}):void 0:null},getSpecial:function(){var a;return(a=h.exec(this.remaining()))?(this.pos+=a[0].length,{v:g[a[0]]}):void 0},getNumber:function(){var a;return(a=i.exec(this.remaining()))?(this.pos+=a[0].length,{v:+a[0]}):void 0},getString:function(){var a,b=c(this);return b&&(a=this.values)?{v:b.v.replace(j,function(b,c){return a[c]||c})}:b},getObject:function(){var a,b;if(!this.getStringMatch("{"))return null;for(a={};b=e(this);){if(a[b.key]=b.value,this.allowWhitespace(),this.getStringMatch("}"))return{v:a};if(!this.getStringMatch(","))return null}return null},getArray:function(){var a,b;if(!this.getStringMatch("["))return null;for(a=[];b=this.getToken();){if(a.push(b.v),this.getStringMatch("]"))return{v:a};if(!this.getStringMatch(","))return null}return null},allowWhitespace:b},function(a,b){var c=new f(a,b);return c.result?{value:c.result.v,remaining:c.remaining()}:null}}(Ob,Pb,Tb,Wb),Yb=function(a,b,c,d,e){function f(a){return"string"==typeof a?a:JSON.stringify(a)}var g=function(b){this.type=a.INTERPOLATOR,c(this,b)};return g.prototype={update:d,resolve:e,render:function(a){this.value=a,this.parentFragment.bubble()},teardown:function(){b(this)},toString:function(){return void 0==this.value?"":f(this.value)}},g}(k,nb,wb,yb,xb),Zb=function(a,b,c,d,e,f,g){var h,i;return g.push(function(){i=g.StringFragment}),h=function(c){this.type=a.SECTION,this.fragments=[],this.length=0,b(this,c)},h.prototype={update:c,resolve:d,teardown:function(){this.teardownFragments(),f(this)},teardownFragments:function(){for(;this.fragments.length;)this.fragments.shift().teardown();this.length=0},bubble:function(){this.value=this.fragments.join(""),this.parentFragment.bubble()},render:function(a){var b;(b=this.root._wrapped[this.keypath])&&(a=b.get()),e(this,a),this.parentFragment.bubble()},createFragment:function(a){return new i(a)},toString:function(){return this.fragments.join("")}},h}(k,wb,yb,xb,Ab,nb,Eb),$b=function(a){var b=function(b){this.type=a.TEXT,this.text=b};return b.prototype={toString:function(){return this.text},teardown:function(){}},b}(k),_b=function(a,b){return function(){var c,d,e,f,g,h,i;if(!this.argsList||this.dirty){if(c={},d=0,f=this.root._guid,i=function(a){return a.map(function(a){var b,e,g;return a.text?a.text:a.fragments?a.fragments.map(function(a){return i(a.items)}).join(""):(b=f+"-"+d++,g=(e=a.root._wrapped[a.keypath])?e.value:a.value,c[b]=g,"${"+b+"}")}).join("")},e=i(this.items),h=b("["+e+"]",c))this.argsList=h.value;else{if(g="Could not parse directive arguments ("+this.toString()+"). If you think this is a bug, please file an issue at http://github.com/RactiveJS/Ractive/issues",this.root.debug)throw new Error(g);a(g),this.argsList=[e]}this.dirty=!1}return this.argsList}}(I,Xb),ac=function(a,b,c,d,e,f,g,h){var i=function(a){c(this,a)};return i.prototype={createItem:function(b){if("string"==typeof b.descriptor)return new f(b.descriptor);switch(b.descriptor.t){case a.INTERPOLATOR:return new d(b);case a.TRIPLE:return new d(b);case a.SECTION:return new e(b);default:throw"Something went wrong in a rather interesting way"}},bubble:function(){this.dirty=!0,this.owner.bubble()},teardown:function(){var a,b;for(a=this.items.length,b=0;a>b;b+=1)this.items[b].teardown()},getValue:function(){var b;return 1===this.items.length&&this.items[0].type===a.INTERPOLATOR&&(b=this.items[0].value,void 0!==b)?b:this.toString()},isSimple:function(){var b,c,d;if(void 0!==this.simple)return this.simple;for(b=this.items.length;b--;)if(c=this.items[b],c.type!==a.TEXT){if(c.type!==a.INTERPOLATOR)return this.simple=!1;if(d)return!1;d=!0}return this.simple=!0},toString:function(){return this.items.join("")},toJSON:function(){var a,c=this.getValue();return"string"==typeof c&&(a=b(c),c=a?a.value:c),c},toArgsList:g},h.StringFragment=i,i}(k,Xb,kb,Yb,Zb,$b,_b,Eb),bc=function(a,b,c,d,e,f,g){var h=function(e){return this.type=a.ATTRIBUTE,this.element=e.element,b(this,e.name),null===e.value||"string"==typeof e.value?(c(this,e),void 0):(this.root=e.root,this.pNode=e.pNode,this.parentFragment=this.element.parentFragment,this.fragment=new g({descriptor:e.value,root:this.root,owner:this,contextStack:e.contextStack}),this.pNode&&("value"===this.name&&(this.isValueAttribute=!0,"INPUT"===this.pNode.tagName&&"file"===this.pNode.type&&(this.isFileInputValue=!0)),d(this,e),this.selfUpdating=this.fragment.isSimple(),this.ready=!0),void 0)};return h.prototype={bind:e,update:f,updateBindings:function(){this.keypath=this.interpolator.keypath||this.interpolator.ref,"name"===this.propertyName&&(this.pNode.name="{{"+this.keypath+"}}")
},teardown:function(){var a;if(this.boundEvents)for(a=this.boundEvents.length;a--;)this.pNode.removeEventListener(this.boundEvents[a],this.updateModel,!1);this.fragment&&this.fragment.teardown()},bubble:function(){this.selfUpdating?this.update():!this.deferred&&this.ready&&(this.root._deferred.attrs.push(this),this.deferred=!0)},toString:function(){var a;return null===this.value?this.name:this.fragment?(a=this.fragment.toString(),this.name+"="+JSON.stringify(a)):this.name+"="+JSON.stringify(this.value)}},h}(k,Jb,Kb,Lb,Mb,Nb,ac),cc=function(a){return function(b,c){var d,e,f;b.attributes=[];for(d in c)c.hasOwnProperty(d)&&(e=c[d],f=new a({element:b,name:d,value:e,root:b.root,pNode:b.node,contextStack:b.parentFragment.contextStack}),b.attributes[b.attributes.length]=b.attributes[d]=f,"name"!==d&&f.update());return b.attributes}}(bc),dc=function(a,b,c,d){var e,f,g;return d.push(function(){e=d.DomFragment}),f=function(){var a=this.node,b=this.fragment.toString();a.styleSheet&&(a.styleSheet.cssText=b),a.innerHTML=b},g=function(){this.node.type&&"text/javascript"!==this.node.type||a("Script tag was updated. This does not cause the code to be re-evaluated!"),this.node.innerHTML=this.fragment.toString()},function(a,d,h,i){var j,k,l,m,n;if("script"===a.lcName||"style"===a.lcName)return a.fragment=new c({descriptor:h.f,root:a.root,contextStack:a.parentFragment.contextStack,owner:a}),i&&("script"===a.lcName?(a.bubble=g,a.node.innerHTML=a.fragment.toString()):(a.bubble=f,a.bubble())),void 0;if("string"!=typeof h.f||d&&d.namespaceURI&&d.namespaceURI!==b.html)a.fragment=new e({descriptor:h.f,root:a.root,pNode:d,contextStack:a.parentFragment.contextStack,owner:a}),i&&d.appendChild(a.fragment.docFrag);else if(a.html=h.f,i)for(d.innerHTML=a.html,j=a.root._liveQueries,k=j.length;k--;)if(l=j[k],(m=d.querySelectorAll(l))&&(n=m.length))for((a.liveQueries||(a.liveQueries=[])).push(l),a.liveQueries[l]=[];n--;)a.liveQueries[l][n]=m[n]}}(I,d,ac,Eb),ec=function(a,b){var c=function(c,d,e,f){var g,h,i;if(this.root=d,this.node=e.node,g=c.n||c,"string"!=typeof g&&(h=new b({descriptor:g,root:this.root,owner:e,contextStack:f}),g=h.toString(),h.teardown()),c.a?this.params=c.a:c.d&&(h=new b({descriptor:c.d,root:this.root,owner:e,contextStack:f}),this.params=h.toArgsList(),h.teardown()),this.fn=d.decorators[g],!this.fn){if(i='Missing "'+g+'" decorator. You may need to download a plugin via https://github.com/RactiveJS/Ractive/wiki/Plugins#decorators',d.debug)throw new Error(i);a(i)}};return c.prototype={init:function(){var a,b;if(this.params?(b=[this.node].concat(this.params),a=this.fn.apply(this.root,b)):a=this.fn.call(this.root,this.node),!a||!a.teardown)throw new Error("Decorator definition must return an object with a teardown method");this.teardown=a.teardown}},c}(I,ac),fc=function(a){return function(b,c,d,e){d.decorator=new a(b,c,d,e),d.decorator.fn&&c._deferred.decorators.push(d.decorator)}}(ec),gc=function(a,b){var c,d,e,f,g,h,i,j,k;return c=function(a,b,c,e,f){var g,h;g=a.node._ractive.events,h=g[b]||(g[b]=new d(a,b,e,f)),h.add(c)},d=function(b,c,d){var e;this.element=b,this.root=b.root,this.node=b.node,this.name=c,this.contextStack=d,this.proxies=[],(e=this.root.events[c])?this.custom=e(this.node,k(c)):("on"+c in this.node||a('Missing "'+this.name+'" event. You may need to download a plugin via https://github.com/RactiveJS/Ractive/wiki/Plugins#events'),this.node.addEventListener(c,j,!1))},d.prototype={add:function(a){this.proxies[this.proxies.length]=new e(this.element,this.root,a,this.contextStack)},teardown:function(){var a;for(this.custom?this.custom.teardown():this.node.removeEventListener(this.name,j,!1),a=this.proxies.length;a--;)this.proxies[a].teardown()},fire:function(a){for(var b=this.proxies.length;b--;)this.proxies[b].fire(a)}},e=function(a,c,d,e){var i;return this.root=c,i=d.n||d,this.n="string"==typeof i?i:new b({descriptor:d.n,root:this.root,owner:a,contextStack:e}),d.a?(this.a=d.a,this.fire=g,void 0):d.d?(this.d=new b({descriptor:d.d,root:this.root,owner:a,contextStack:e}),this.fire=h,void 0):(this.fire=f,void 0)},e.prototype={teardown:function(){this.n.teardown&&this.n.teardown(),this.d&&this.d.teardown()},bubble:function(){}},f=function(a){this.root.fire(this.n.toString(),a)},g=function(a){this.root.fire.apply(this.root,[this.n.toString(),a].concat(this.a))},h=function(a){var b=this.d.toArgsList();"string"==typeof b&&(b=b.substr(1,b.length-2)),this.root.fire.apply(this.root,[this.n.toString(),a].concat(b))},j=function(a){var b=this._ractive;b.events[a.type].fire({node:this,original:a,index:b.index,keypath:b.keypath,context:b.root.get(b.keypath)})},i={},k=function(a){return i[a]?i[a]:i[a]=function(b){var c=b.node._ractive;b.index=c.index,b.keypath=c.keypath,b.context=c.root.get(c.keypath),c.events[a].fire(b)}},c}(I,ac),hc=function(a){return function(b,c){var d,e,f;for(e in c)if(c.hasOwnProperty(e))for(f=e.split("-"),d=f.length;d--;)a(b,f[d],c[e],b.parentFragment.contextStack)}}(gc),ic=function(){return function(a){var b,c,d,e,f;for(b=a.root,c=b._liveQueries,d=c.length;d--;)e=c[d],f=c[e],f._test(a)&&((a.liveQueries||(a.liveQueries=[])).push(e),a.liveQueries[e]=[a.node])}}(),jc=function(){return function(a){return a.replace(/-([a-zA-Z])/g,function(a,b){return b.toUpperCase()})}}(),kc=function(){return function(a,b){var c;for(c in b)b.hasOwnProperty(c)&&!a.hasOwnProperty(c)&&(a[c]=b[c]);return a}}(),lc=function(a,b,c,d,e,f,g,h){function i(a){var b,c,d;if(!q[a])if(void 0!==m[a])q[a]=a;else for(d=a.charAt(0).toUpperCase()+a.substring(1),b=n.length;b--;)if(c=n[b],void 0!==m[c+d]){q[a]=c+d;break}return q[a]}function j(a){return a.replace(p,"")}function k(a){var b;return o.test(a)&&(a="-"+a),b=a.replace(/[A-Z]/g,function(a){return"-"+a.toLowerCase()})}var l,m,n,o,p,q,r,s,t,u,v,w;if(a)return m=b("div").style,function(){void 0!==m.transition?(s="transition",w="transitionend",r=!0):void 0!==m.webkitTransition?(s="webkitTransition",w="webkitTransitionEnd",r=!0):r=!1}(),s&&(t=s+"Duration",u=s+"Property",v=s+"TimingFunction"),l=function(a,b,d,e,f){var g,i,j,k=this;if(this.root=b,this.node=d.node,this.isIntro=f,this.originalStyle=this.node.getAttribute("style"),this.complete=function(a){!a&&k.isIntro&&k.resetStyle(),k._manager.pop(k.node),k.node._ractive.transition=null},g=a.n||a,"string"!=typeof g&&(i=new h({descriptor:g,root:this.root,owner:d,contextStack:e}),g=i.toString(),i.teardown()),this.name=g,a.a?this.params=a.a:a.d&&(i=new h({descriptor:a.d,root:this.root,owner:d,contextStack:e}),this.params=i.toArgsList(),i.teardown()),this._fn=b.transitions[g],!this._fn){if(j='Missing "'+g+'" transition. You may need to download a plugin via https://github.com/RactiveJS/Ractive/wiki/Plugins#transitions',b.debug)throw new Error(j);return c(j),void 0}},l.prototype={init:function(){if(this._inited)throw new Error("Cannot initialize a transition more than once");this._inited=!0,this._fn.apply(this.root,[this].concat(this.params))},getStyle:function(a){var b,c,d,f,g;if(b=window.getComputedStyle(this.node),"string"==typeof a)return g=b[i(a)],"0px"===g&&(g=0),g;if(!e(a))throw new Error("Transition#getStyle must be passed a string, or an array of strings representing CSS properties");for(c={},d=a.length;d--;)f=a[d],g=b[i(f)],"0px"===g&&(g=0),c[f]=g;return c},setStyle:function(a,b){var c;if("string"==typeof a)this.node.style[i(a)]=b;else for(c in a)a.hasOwnProperty(c)&&(this.node.style[i(c)]=a[c]);return this},animateStyle:function(a,b,d,e){var g,h,l,m,n,o,p,q,r,s=this;for("string"==typeof a?(n={},n[a]=b):(n=a,e=d,d=b),d||(c('The "'+s.name+'" transition does not supply an options object to `t.animateStyle()`. This will break in a future version of Ractive. For more info see https://github.com/RactiveJS/Ractive/issues/340'),d=s,e=s.complete),d.duration||(s.setStyle(n),e&&e()),g=Object.keys(n),h=[],l=window.getComputedStyle(s.node),o={},q=g.length;q--;)r=g[q],m=l[i(r)],"0px"===m&&(m=0),m!=n[r]&&(h[h.length]=r,s.node.style[i(r)]=m);return h.length?(setTimeout(function(){s.node.style[u]=g.map(i).map(k).join(","),s.node.style[v]=k(d.easing||"linear"),s.node.style[t]=d.duration/1e3+"s",p=function(a){var b;b=h.indexOf(f(j(a.propertyName))),-1!==b&&h.splice(b,1),h.length||(s.root.fire(s.name+":end"),s.node.removeEventListener(w,p,!1),e&&e())},s.node.addEventListener(w,p,!1),setTimeout(function(){for(var a=h.length;a--;)r=h[a],s.node.style[i(r)]=n[r]},0)},d.delay||0),void 0):(e&&e(),void 0)},resetStyle:function(){this.originalStyle?this.node.setAttribute("style",this.originalStyle):(this.node.getAttribute("style"),this.node.removeAttribute("style"))},processParams:function(a,b){return"number"==typeof a?a={duration:a}:"string"==typeof a?a="slow"===a?{duration:600}:"fast"===a?{duration:200}:{duration:400}:a||(a={}),g(a,b)}},n=["o","ms","moz","webkit"],o=new RegExp("^(?:"+n.join("|")+")([A-Z])"),p=new RegExp("^-(?:"+n.join("|")+")-"),q={},l}(f,e,I,J,l,jc,kc,ac),mc=function(a,b){return function(a,c,d,e,f){var g,h,i;!c.transitionsEnabled||c._parent&&!c._parent.transitionsEnabled||(g=new b(a,c,d,e,f),g._fn&&(h=g.node,g._manager=c._transitionManager,(i=h._ractive.transition)&&i.complete(),h._ractive.transition=g,g._manager.push(h),f?c._deferred.transitions.push(g):g.init()))}}(I,lc),nc=function(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o){return function(e,p,q){var r,s,t,u,v,w,x,y,z,A,B,C,D;if(e.type=a.ELEMENT,r=e.parentFragment=p.parentFragment,s=r.pNode,t=r.contextStack,u=e.descriptor=p.descriptor,e.root=B=r.root,e.index=p.index,e.lcName=u.e.toLowerCase(),e.eventListeners=[],e.customEventListeners=[],s&&(v=e.namespace=h(u,s),w=v!==b.html?o(u.e):u.e,e.node=g(w,v),d(e.node,"_ractive",{value:{proxy:e,keypath:t.length?t[t.length-1]:"",index:r.indexRefs,events:c(null),root:B}})),x=i(e,u.a),u.f){if(e.node&&e.node.getAttribute("contenteditable")&&e.node.innerHTML){if(D="A pre-populated contenteditable element should not have children",B.debug)throw new Error(D);f(D)}j(e,e.node,u,q)}q&&u.v&&l(e,u.v),q&&(B.twoway&&(e.bind(),e.node.getAttribute("contenteditable")&&e.node._ractive.binding&&e.node._ractive.binding.update()),x.name&&!x.name.twoway&&x.name.update(),"IMG"===e.node.tagName&&((y=e.attributes.width)||(z=e.attributes.height))&&e.node.addEventListener("load",A=function(){y&&(e.node.width=y.value),z&&(e.node.height=z.value),e.node.removeEventListener("load",A,!1)},!1),q.appendChild(e.node),u.o&&k(u.o,B,e,t),u.t1&&n(u.t1,B,e,t,!0),"OPTION"===e.node.tagName&&("SELECT"===s.tagName&&(C=s._ractive.binding)&&C.deferUpdate(),e.node._ractive.value==s._ractive.value&&(e.node.selected=!0)),e.node.autofocus&&(B._deferred.focusable=e.node)),m(e)}}(k,d,c,g,Z,I,e,Hb,cc,dc,fc,hc,ic,mc,Ib),oc=function(a){return function(b){var c,d,e,f,g,h,i,j,k;for(this.fragment&&this.fragment.teardown(!1);this.attributes.length;)this.attributes.pop().teardown();if(this.node){for(c in this.node._ractive.events)this.node._ractive.events[c].teardown();(d=this.node._ractive.binding)&&(d.teardown(),e=this.root._twowayBindings[d.attr.keypath],e.splice(e.indexOf(d),1))}if(this.decorator&&this.decorator.teardown(),this.descriptor.t2&&a(this.descriptor.t2,this.root,this,this.parentFragment.contextStack,!1),b&&this.root._transitionManager.detachWhenReady(this),g=this.liveQueries)for(f=g.length;f--;)if(h=g[f],j=this.liveQueries[h])for(k=j.length,i=this.root._liveQueries[h];k--;)i._remove(j[k])}}(mc),pc=function(){return"area base br col command doctype embed hr img input keygen link meta param source track wbr".split(" ")}(),qc=function(a){return function(){var b,c,d;for(b="<"+(this.descriptor.y?"!doctype":this.descriptor.e),d=this.attributes.length,c=0;d>c;c+=1)b+=" "+this.attributes[c].toString();return b+=">",this.html?b+=this.html:this.fragment&&(b+=this.fragment.toString()),-1===a.indexOf(this.descriptor.e)&&(b+="</"+this.descriptor.e+">"),b}}(pc),rc=function(a){return function(b){var c;return a(this.node,b)?this.node:this.html&&(c=this.node.querySelector(b))?c:this.fragment&&this.fragment.find?this.fragment.find(b):void 0}}(Z),sc=function(){return function(a,b){var c,d,e,f,g;if(b._test(this,!0)&&b.live&&((this.liveQueries||(this.liveQueries=[])).push(a),this.liveQueries[a]=[this.node]),this.html&&(c=this.node.querySelectorAll(a))&&(e=c.length))for(b.live&&(this.liveQueries[a]||((this.liveQueries||(this.liveQueries=[])).push(a),this.liveQueries[a]=[]),g=this.liveQueries[a]),d=0;e>d;d+=1)f=c[d],b.push(f),b.live&&g.push(f);this.fragment&&this.fragment.findAll(a,b)}}(),tc=function(){return function(a){return this.fragment?this.fragment.findComponent(a):void 0}}(),uc=function(){return function(a,b){this.fragment&&this.fragment.findAllComponents(a,b)}}(),vc=function(){return function(){var a=this.attributes;if(this.node&&(this.binding&&(this.binding.teardown(),this.binding=null),!(this.node.getAttribute("contenteditable")&&a.value&&a.value.bind())))switch(this.descriptor.e){case"select":case"textarea":return a.value&&a.value.bind(),void 0;case"input":if("radio"===this.node.type||"checkbox"===this.node.type){if(a.name&&a.name.bind())return;if(a.checked&&a.checked.bind())return}if(a.value&&a.value.bind())return}}}(),wc=function(a,b,c,d,e,f,g,h){var i=function(b,c){a(this,b,c)};return i.prototype={detach:function(){return this.node?(this.node.parentNode&&this.node.parentNode.removeChild(this.node),this.node):void 0},teardown:b,firstNode:function(){return this.node},findNextNode:function(){return null},bubble:function(){},toString:c,find:d,findAll:e,findComponent:f,findAllComponents:g,bind:h},i}(nc,oc,qc,rc,sc,tc,uc,vc),xc={missingParser:"Missing Ractive.parse - cannot parse template. Either preparse or use the version that includes the parser"},yc={},zc=function(){return function(a){var b,c,d;for(d="";a.length;){if(b=a.indexOf("<!--"),c=a.indexOf("-->"),-1===b&&-1===c){d+=a;break}if(-1!==b&&-1===c)throw"Illegal HTML - expected closing comment sequence ('-->')";if(-1!==c&&-1===b||b>c)throw"Illegal HTML - unexpected closing comment sequence ('-->')";d+=a.substr(0,b),a=a.substring(c+3)}return d}}(),Ac=function(a){return function(b){var c,d,e,f,g,h;for(g=/^\s*\r?\n/,h=/\r?\n\s*$/,c=2;c<b.length;c+=1)d=b[c],e=b[c-1],f=b[c-2],d.type===a.TEXT&&e.type===a.MUSTACHE&&f.type===a.TEXT&&h.test(f.value)&&g.test(d.value)&&(e.mustacheType!==a.INTERPOLATOR&&e.mustacheType!==a.TRIPLE&&(f.value=f.value.replace(h,"\n")),d.value=d.value.replace(g,""),""===d.value&&b.splice(c--,1));return b}}(k),Bc=function(a){return function(b){var c,d,e,f;for(c=0;c<b.length;c+=1)d=b[c],e=b[c-1],f=b[c+1],(d.mustacheType===a.COMMENT||d.mustacheType===a.DELIMCHANGE)&&(b.splice(c,1),e&&f&&e.type===a.TEXT&&f.type===a.TEXT&&(e.value+=f.value,b.splice(c,1)),c-=1);return b}}(k),Cc=function(a){var b=a(/^[^\s=]+/);return function(a){var c,d,e;return a.getStringMatch("=")?(c=a.pos,a.allowWhitespace(),(d=b(a))?(a.allowWhitespace(),(e=b(a))?(a.allowWhitespace(),a.getStringMatch("=")?[d,e]:(a.pos=c,null)):(a.pos=c,null)):(a.pos=c,null)):null}}(Qb),Dc=function(a){var b={"#":a.SECTION,"^":a.INVERTED,"/":a.CLOSING,">":a.PARTIAL,"!":a.COMMENT,"&":a.TRIPLE};return function(a){var c=b[a.str.charAt(a.pos)];return c?(a.pos+=1,c):null}}(k),Ec=function(a,b,c){var d=b(/^\s*:\s*([a-zA-Z_$][a-zA-Z_$0-9]*)/),e=/^[0-9][1-9]*$/;return function(b,f){var g,h,i,j,k,l,m;if(g=b.pos,h={type:f?a.TRIPLE:a.MUSTACHE},!(f||((j=b.getExpression())&&(h.mustacheType=a.INTERPOLATOR,b.allowWhitespace(),b.getStringMatch(b.delimiters[1])?b.pos-=b.delimiters[1].length:(b.pos=g,j=null)),j||(i=c(b),i===a.TRIPLE?h={type:a.TRIPLE}:h.mustacheType=i||a.INTERPOLATOR,i!==a.COMMENT&&i!==a.CLOSING||(l=b.remaining(),m=l.indexOf(b.delimiters[1]),-1===m)))))return h.ref=l.substr(0,m),b.pos+=m,h;for(j||(b.allowWhitespace(),j=b.getExpression());j.t===a.BRACKETED&&j.x;)j=j.x;return j.t===a.REFERENCE?h.ref=j.n:j.t===a.NUMBER_LITERAL&&e.test(j.v)?h.ref=j.v:h.expression=j,k=d(b),null!==k&&(h.indexRef=k),h}}(k,Qb,Dc),Fc=function(a,b,c){function d(d,e){var f,g,h=d.pos;return g=e?d.tripleDelimiters:d.delimiters,d.getStringMatch(g[0])?(f=b(d))?d.getStringMatch(g[1])?(d[e?"tripleDelimiters":"delimiters"]=f,{type:a.MUSTACHE,mustacheType:a.DELIMCHANGE}):(d.pos=h,null):(d.allowWhitespace(),f=c(d,e),null===f?(d.pos=h,null):(d.allowWhitespace(),d.getStringMatch(g[1])?f:(d.pos=h,null))):null}return function(){var a=this.tripleDelimiters[0].length>this.delimiters[0].length;return d(this,a)||d(this,!a)}}(k,Cc,Ec),Gc=function(a){return function(){var b,c,d;if(!this.getStringMatch("<!--"))return null;if(c=this.remaining(),d=c.indexOf("-->"),-1===d)throw new Error('Unexpected end of input (expected "-->" to close comment)');return b=c.substr(0,d),this.pos+=d+3,{type:a.COMMENT,content:b}}}(k),Hc=function(){return function(a,b){var c,d,e;for(c=b.length;c--;){if(d=a.indexOf(b[c]),!d)return 0;-1!==d&&(!e||e>d)&&(e=d)}return e||-1}}(),Ic=function(a,b,c){var d,e,f,g,h,i,j,k,l,m,n,o,p;return d=function(){return e(this)||f(this)},e=function(b){var c,d,e,f;return c=b.pos,b.inside?null:b.getStringMatch("<")?(d={type:a.TAG},b.getStringMatch("!")&&(d.doctype=!0),d.name=g(b),d.name?(e=h(b),e&&(d.attrs=e),b.allowWhitespace(),b.getStringMatch("/")&&(d.selfClosing=!0),b.getStringMatch(">")?(f=d.name.toLowerCase(),("script"===f||"style"===f)&&(b.inside=f),d):(b.pos=c,null)):(b.pos=c,null)):null},f=function(b){var c,d,e;if(c=b.pos,e=function(a){throw new Error("Unexpected character "+b.remaining().charAt(0)+" (expected "+a+")")},!b.getStringMatch("<"))return null;if(d={type:a.TAG,closing:!0},b.getStringMatch("/")||e('"/"'),d.name=g(b),d.name||e("tag name"),b.getStringMatch(">")||e('">"'),b.inside){if(d.name.toLowerCase()!==b.inside)return b.pos=c,null;b.inside=null}return d},g=b(/^[a-zA-Z]{1,}:?[a-zA-Z0-9\-]*/),h=function(a){var b,c,d;if(b=a.pos,a.allowWhitespace(),d=i(a),!d)return a.pos=b,null;for(c=[];null!==d;)c[c.length]=d,a.allowWhitespace(),d=i(a);return c},i=function(a){var b,c,d;return(c=j(a))?(b={name:c},d=k(a),d&&(b.value=d),b):null},j=b(/^[^\s"'>\/=]+/),k=function(a){var b,c;return b=a.pos,a.allowWhitespace(),a.getStringMatch("=")?(a.allowWhitespace(),c=p(a,"'")||p(a,'"')||l(a),null===c?(a.pos=b,null):c):(a.pos=b,null)},n=b(/^[^\s"'=<>`]+/),m=function(b){var c,d,e;return c=b.pos,(d=n(b))?(-1!==(e=d.indexOf(b.delimiters[0]))&&(d=d.substr(0,e),b.pos=c+d.length),{type:a.TEXT,value:d}):null},l=function(a){var b,c;for(b=[],c=a.getMustache()||m(a);null!==c;)b[b.length]=c,c=a.getMustache()||m(a);return b.length?b:null},p=function(a,b){var c,d,e;if(c=a.pos,!a.getStringMatch(b))return null;for(d=[],e=a.getMustache()||o(a,b);null!==e;)d[d.length]=e,e=a.getMustache()||o(a,b);return a.getStringMatch(b)?d:(a.pos=c,null)},o=function(b,d){var e,f,g;if(e=b.pos,g=b.remaining(),f=c(g,[d,b.delimiters[0],b.delimiters[1]]),-1===f)throw new Error("Quoted attribute value must have a closing quote");return f?(b.pos+=f,{type:a.TEXT,value:g.substr(0,f)}):null},d}(k,Qb,Hc),Jc=function(a,b){return function(){var c,d,e;return d=this.remaining(),e=this.inside?"</"+this.inside:"<",(c=b(d,[e,this.delimiters[0],this.tripleDelimiters[0]]))?(-1===c&&(c=d.length),this.pos+=c,{type:a.TEXT,value:d.substr(0,c)}):null}}(k,Hc),Kc=function(a){return function(b){var c=b.remaining();return"true"===c.substr(0,4)?(b.pos+=4,{t:a.BOOLEAN_LITERAL,v:"true"}):"false"===c.substr(0,5)?(b.pos+=5,{t:a.BOOLEAN_LITERAL,v:"false"}):null}}(k),Lc=function(a,b){return function(c){var d,e,f;return d=c.pos,c.allowWhitespace(),e=b(c),null===e?(c.pos=d,null):(c.allowWhitespace(),c.getStringMatch(":")?(c.allowWhitespace(),f=c.getExpression(),null===f?(c.pos=d,null):{t:a.KEY_VALUE_PAIR,k:e,v:f}):(c.pos=d,null))}}(k,Wb),Mc=function(a){return function b(c){var d,e,f,g;return d=c.pos,f=a(c),null===f?null:(e=[f],c.getStringMatch(",")?(g=b(c),g?e.concat(g):(c.pos=d,null)):e)}}(Lc),Nc=function(a,b){return function(c){var d,e;return d=c.pos,c.allowWhitespace(),c.getStringMatch("{")?(e=b(c),c.allowWhitespace(),c.getStringMatch("}")?{t:a.OBJECT_LITERAL,m:e}:(c.pos=d,null)):(c.pos=d,null)}}(k,Mc),Oc=function(){return function a(b){var c,d,e,f;if(c=b.pos,b.allowWhitespace(),e=b.getExpression(),null===e)return null;if(d=[e],b.allowWhitespace(),b.getStringMatch(",")){if(f=a(b),null===f)return b.pos=c,null;d=d.concat(f)}return d}}(),Pc=function(a,b){return function(c){var d,e;return d=c.pos,c.allowWhitespace(),c.getStringMatch("[")?(e=b(c),c.getStringMatch("]")?{t:a.ARRAY_LITERAL,m:e}:(c.pos=d,null)):(c.pos=d,null)}}(k,Oc),Qc=function(a,b,c,d,e){return function(f){var g=a(f)||b(f)||c(f)||d(f)||e(f);return g}}(Ub,Kc,Tb,Nc,Pc),Rc=function(a,b,c){var d,e,f,g;return d=b(/^\.[a-zA-Z_$0-9]+/),e=function(a){var b=f(a);return b?"."+b:null},f=b(/^\[(0|[1-9][0-9]*)\]/),g=/^(?:Array|Date|RegExp|decodeURIComponent|decodeURI|encodeURIComponent|encodeURI|isFinite|isNaN|parseFloat|parseInt|JSON|Math|NaN|undefined|null)$/,function(b){var f,h,i,j,k,l,m;for(f=b.pos,h="";b.getStringMatch("../");)h+="../";if(h||(j=b.getStringMatch(".")||""),i=c(b)||"",!h&&!j&&g.test(i))return{t:a.GLOBAL,v:i};if("this"!==i||h||j||(i=".",f+=3),k=(h||j)+i,!k)return null;for(;l=d(b)||e(b);)k+=l;return b.getStringMatch("(")&&(m=k.lastIndexOf("."),-1!==m?(k=k.substr(0,m),b.pos=f+k.length):b.pos-=1),{t:a.REFERENCE,n:k}}}(k,Qb,Vb),Sc=function(a){return function(b){var c,d;return c=b.pos,b.getStringMatch("(")?(b.allowWhitespace(),(d=b.getExpression())?(b.allowWhitespace(),b.getStringMatch(")")?{t:a.BRACKETED,x:d}:(b.pos=c,null)):(b.pos=c,null)):null}}(k),Tc=function(a,b,c){return function(d){return a(d)||b(d)||c(d)}}(Qc,Rc,Sc),Uc=function(a,b){return function(c){var d,e,f;if(d=c.pos,c.allowWhitespace(),c.getStringMatch(".")){if(c.allowWhitespace(),e=b(c))return{t:a.REFINEMENT,n:e};c.expected("a property name")}return c.getStringMatch("[")?(c.allowWhitespace(),f=c.getExpression(),f||c.expected("an expression"),c.allowWhitespace(),c.getStringMatch("]")||c.expected('"]"'),{t:a.REFINEMENT,x:f}):null}}(k,Vb),Vc=function(a,b,c,d){return function(e){var f,g,h,i;if(g=b(e),!g)return null;for(;g;)if(f=e.pos,h=d(e))g={t:a.MEMBER,x:g,r:h};else{if(!e.getStringMatch("("))break;if(e.allowWhitespace(),i=c(e),e.allowWhitespace(),!e.getStringMatch(")")){e.pos=f;break}g={t:a.INVOCATION,x:g},i&&(g.o=i)}return g}}(k,Tc,Oc,Uc),Wc=function(a,b){var c,d;return d=function(b,c){return function(d){var e,f;return d.getStringMatch(b)?(e=d.pos,d.allowWhitespace(),f=d.getExpression(),f||d.expected("an expression"),{s:b,o:f,t:a.PREFIX_OPERATOR}):c(d)}},function(){var a,e,f,g,h;for(g="! ~ + - typeof".split(" "),h=b,a=0,e=g.length;e>a;a+=1)f=d(g[a],h),h=f;c=h}(),c}(k,Vc),Xc=function(a,b){var c,d;return d=function(b,c){return function(d){var e,f,g;return(f=c(d))?(e=d.pos,d.allowWhitespace(),d.getStringMatch(b)?"in"===b&&/[a-zA-Z_$0-9]/.test(d.remaining().charAt(0))?(d.pos=e,f):(d.allowWhitespace(),g=d.getExpression(),g?{t:a.INFIX_OPERATOR,s:b,o:[f,g]}:(d.pos=e,f)):(d.pos=e,f)):null}},function(){var a,e,f,g,h;for(g="* / % + - << >> >>> < <= > >= in instanceof == != === !== & ^ | && ||".split(" "),h=b,a=0,e=g.length;e>a;a+=1)f=d(g[a],h),h=f;c=h}(),c}(k,Wc),Yc=function(a,b){return function(c){var d,e,f,g;return(e=b(c))?(d=c.pos,c.allowWhitespace(),c.getStringMatch("?")?(c.allowWhitespace(),(f=c.getExpression())?(c.allowWhitespace(),c.getStringMatch(":")?(c.allowWhitespace(),g=c.getExpression(),g?{t:a.CONDITIONAL,o:[e,f,g]}:(c.pos=d,e)):(c.pos=d,e)):(c.pos=d,e)):(c.pos=d,e)):null}}(k,Xc),Zc=function(a){return function(){return a(this)}}(Yc),$c=function(a,b,c,d,e,f,g){var h;return h=function(a,b){var c;for(this.str=a,this.pos=0,this.delimiters=b.delimiters,this.tripleDelimiters=b.tripleDelimiters,this.tokens=[];this.pos<this.str.length;)c=this.getToken(),null===c&&this.remaining()&&this.fail(),this.tokens.push(c)},h.prototype={getToken:function(){var a=this.getMustache()||this.getComment()||this.getTag()||this.getText();return a},getMustache:a,getComment:b,getTag:c,getText:d,getExpression:e,allowWhitespace:f,getStringMatch:g,remaining:function(){return this.str.substring(this.pos)},fail:function(){var a,b;throw a=this.str.substr(0,this.pos).substr(-20),20===a.length&&(a="..."+a),b=this.remaining().substr(0,20),20===b.length&&(b+="..."),new Error("Could not parse template: "+(a?a+"<- ":"")+"failed at character "+this.pos+" ->"+b)},expected:function(a){var b=this.remaining().substr(0,40);throw 40===b.length&&(b+="..."),new Error('Tokenizer failed: unexpected string "'+b+'" (expected '+a+")")}},h}(Fc,Gc,Ic,Jc,Zc,Pb,Ob),_c=function(a,b,c,d,e){var f,g;return e.push(function(){g=e.Ractive}),f=function(e,f){var h,i;return f=f||{},f.stripComments!==!1&&(e=a(e)),h=new d(e,{delimiters:f.delimiters||(g?g.delimiters:["{{","}}"]),tripleDelimiters:f.tripleDelimiters||(g?g.tripleDelimiters:["{{{","}}}"])}),i=h.tokens,b(i),c(i),i}}(zc,Ac,Bc,$c,Eb),ad=function(a){var b,c,d,e,f,g,h,i,j;return b=function(a,b){this.text=b?a.value:a.value.replace(j," ")},b.prototype={type:a.TEXT,toJSON:function(){return this.decoded||(this.decoded=i(this.text))},toString:function(){return this.text}},c={quot:34,amp:38,apos:39,lt:60,gt:62,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,copy:169,ordf:170,laquo:171,not:172,shy:173,reg:174,macr:175,deg:176,plusmn:177,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,sup1:185,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,Agrave:192,Aacute:193,Acirc:194,Atilde:195,Auml:196,Aring:197,AElig:198,Ccedil:199,Egrave:200,Eacute:201,Ecirc:202,Euml:203,Igrave:204,Iacute:205,Icirc:206,Iuml:207,ETH:208,Ntilde:209,Ograve:210,Oacute:211,Ocirc:212,Otilde:213,Ouml:214,times:215,Oslash:216,Ugrave:217,Uacute:218,Ucirc:219,Uuml:220,Yacute:221,THORN:222,szlig:223,agrave:224,aacute:225,acirc:226,atilde:227,auml:228,aring:229,aelig:230,ccedil:231,egrave:232,eacute:233,ecirc:234,euml:235,igrave:236,iacute:237,icirc:238,iuml:239,eth:240,ntilde:241,ograve:242,oacute:243,ocirc:244,otilde:245,ouml:246,divide:247,oslash:248,ugrave:249,uacute:250,ucirc:251,uuml:252,yacute:253,thorn:254,yuml:255,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,"int":8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},d=[8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376],e=new RegExp("&("+Object.keys(c).join("|")+");?","g"),f=/&#x([0-9]+);?/g,g=/&#([0-9]+);?/g,h=function(a){return a?10===a?32:128>a?a:159>=a?d[a-128]:55296>a?a:57343>=a?65533:65535>=a?a:65533:65533},i=function(a){var b;return b=a.replace(e,function(a,b){return c[b]?String.fromCharCode(c[b]):a}),b=b.replace(f,function(a,b){return String.fromCharCode(h(parseInt(b,16)))}),b=b.replace(g,function(a,b){return String.fromCharCode(h(b))})},j=/\s+/g,b}(k),bd=function(a,b){return function(c){return c.type===a.TEXT?(this.pos+=1,new b(c,this.preserveWhitespace)):null}}(k,ad),cd=function(a){var b;return b=function(a){this.content=a.content},b.prototype={toJSON:function(){return{t:a.COMMENT,f:this.content}},toString:function(){return"<!--"+this.content+"-->"}},b}(k),dd=function(a,b){return function(c){return c.type===a.COMMENT?(this.pos+=1,new b(c,this.preserveWhitespace)):null}}(k,cd),ed=function(a,b){var c,d,e;return c=function(a){this.refs=[],d(a,this.refs),this.str=e(a,this.refs)},c.prototype={toJSON:function(){return this.json?this.json:(this.json={r:this.refs,s:this.str},this.json)}},d=function(c,e){var f,g;if(c.t===a.REFERENCE&&-1===e.indexOf(c.n)&&e.unshift(c.n),g=c.o||c.m)if(b(g))d(g,e);else for(f=g.length;f--;)d(g[f],e);c.x&&d(c.x,e),c.r&&d(c.r,e),c.v&&d(c.v,e)},e=function(b,c){var d=function(a){return e(a,c)};switch(b.t){case a.BOOLEAN_LITERAL:case a.GLOBAL:case a.NUMBER_LITERAL:return b.v;case a.STRING_LITERAL:return"'"+b.v.replace(/'/g,"\\'")+"'";case a.ARRAY_LITERAL:return"["+(b.m?b.m.map(d).join(","):"")+"]";case a.OBJECT_LITERAL:return"{"+(b.m?b.m.map(d).join(","):"")+"}";case a.KEY_VALUE_PAIR:return b.k+":"+e(b.v,c);case a.PREFIX_OPERATOR:return("typeof"===b.s?"typeof ":b.s)+e(b.o,c);case a.INFIX_OPERATOR:return e(b.o[0],c)+("in"===b.s.substr(0,2)?" "+b.s+" ":b.s)+e(b.o[1],c);case a.INVOCATION:return e(b.x,c)+"("+(b.o?b.o.map(d).join(","):"")+")";case a.BRACKETED:return"("+e(b.x,c)+")";case a.MEMBER:return e(b.x,c)+e(b.r,c);case a.REFINEMENT:return b.n?"."+b.n:"["+e(b.x,c)+"]";case a.CONDITIONAL:return e(b.o[0],c)+"?"+e(b.o[1],c)+":"+e(b.o[2],c);case a.REFERENCE:return"${"+c.indexOf(b.n)+"}";default:throw new Error("Could not stringify expression token. This error is unexpected")}},c}(k,w),fd=function(a,b){var c=function(c,d){this.type=c.type===a.TRIPLE?a.TRIPLE:c.mustacheType,c.ref&&(this.ref=c.ref),c.expression&&(this.expr=new b(c.expression)),d.pos+=1};return c.prototype={toJSON:function(){var a;return this.json?this.json:(a={t:this.type},this.ref&&(a.r=this.ref),this.expr&&(a.x=this.expr.toJSON()),this.json=a,a)},toString:function(){return!1}},c}(k,ed),gd=function(){return function(a){var b,c,d,e="";if(!a)return"";for(c=0,d=a.length;d>c;c+=1){if(b=a[c].toString(),b===!1)return!1;e+=b}return e}}(),hd=function(a){return function(b,c){var d,e;return c||(d=a(b),d===!1)?e=b.map(function(a){return a.toJSON(c)}):d}}(gd),id=function(a,b,c){var d=function(b,d){var e;for(this.ref=b.ref,this.indexRef=b.indexRef,this.inverted=b.mustacheType===a.INVERTED,b.expression&&(this.expr=new c(b.expression)),d.pos+=1,this.items=[],e=d.next();e;){if(e.mustacheType===a.CLOSING){if(e.ref.trim()===this.ref||this.expr){d.pos+=1;break}throw new Error("Could not parse template: Illegal closing section")}this.items[this.items.length]=d.getStub(),e=d.next()}};return d.prototype={toJSON:function(c){var d;return this.json?this.json:(d={t:a.SECTION},this.ref&&(d.r=this.ref),this.indexRef&&(d.i=this.indexRef),this.inverted&&(d.n=!0),this.expr&&(d.x=this.expr.toJSON()),this.items.length&&(d.f=b(this.items,c)),this.json=d,d)},toString:function(){return!1}},d}(k,hd,ed),jd=function(a,b,c){return function(d){return d.type===a.MUSTACHE||d.type===a.TRIPLE?d.mustacheType===a.SECTION||d.mustacheType===a.INVERTED?new c(d,this):new b(d,this):void 0}}(k,fd,id),kd=function(){return{li:["li"],dt:["dt","dd"],dd:["dt","dd"],p:"address article aside blockquote dir div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr menu nav ol p pre section table ul".split(" "),rt:["rt","rp"],rp:["rp","rt"],optgroup:["optgroup"],option:["option","optgroup"],thead:["tbody","tfoot"],tbody:["tbody","tfoot"],tr:["tr"],td:["td","th"],th:["td","th"]}}(),ld=function(a){function b(c){var d,e;if("object"!=typeof c)return c;if(a(c))return c.map(b);d={};for(e in c)c.hasOwnProperty(e)&&(d[e]=b(c[e]));return d}return function(a){var c,d,e,f,g,h;for(e={},c=[],d=[],g=a.length,f=0;g>f;f+=1)if(h=a[f],"intro"===h.name){if(e.intro)throw new Error("An element can only have one intro transition");
e.intro=h}else if("outro"===h.name){if(e.outro)throw new Error("An element can only have one outro transition");e.outro=h}else if("intro-outro"===h.name){if(e.intro||e.outro)throw new Error("An element can only have one intro and one outro transition");e.intro=h,e.outro=b(h)}else"proxy-"===h.name.substr(0,6)?(h.name=h.name.substring(6),d[d.length]=h):"on-"===h.name.substr(0,3)?(h.name=h.name.substring(3),d[d.length]=h):"decorator"===h.name?e.decorator=h:c[c.length]=h;return e.attrs=c,e.proxies=d,e}}(l),md=function(a,b){return function(c){var d,e,f,g,h,i,j,k;for(h=function(){throw new Error("Illegal directive")},c.name&&c.value||h(),d={directiveType:c.name},e=c.value,i=[],j=[];e.length;)if(f=e.shift(),f.type===a.TEXT){if(g=f.value.indexOf(":"),-1!==g){g&&(i[i.length]={type:a.TEXT,value:f.value.substr(0,g)}),f.value.length>g+1&&(j[0]={type:a.TEXT,value:f.value.substring(g+1)});break}i[i.length]=f}else i[i.length]=f;return j=j.concat(e),d.name=1===i.length&&i[0].type===a.TEXT?i[0].value:i,j.length&&(1===j.length&&j[0].type===a.TEXT?(k=b("["+j[0].value+"]"),d.args=k?k.value:j[0].value):d.dynamicArgs=j),d}}(k,Xb),nd=function(a,b){var c;return c=function(a,b){var c;for(this.tokens=a||[],this.pos=0,this.options=b,this.result=[];c=this.getStub();)this.result.push(c)},c.prototype={getStub:function(){var a=this.next();return a?this.getText(a)||this.getMustache(a):null},getText:a,getMustache:b,next:function(){return this.tokens[this.pos]}},c}(bd,jd),od=function(a,b,c){var d;return d=function(b){var c=new a(b);this.stubs=c.result},d.prototype={toJSON:function(a){var b;return this["json_"+a]?this["json_"+a]:b=this["json_"+a]=c(this.stubs,a)},toString:function(){return void 0!==this.str?this.str:(this.str=b(this.stubs),this.str)}},d}(nd,gd,hd),pd=function(a){return function(b){var c,d;if("string"==typeof b.name){if(!b.args&&!b.dynamicArgs)return b.name;d=b.name}else d=new a(b.name).toJSON();return c={n:d},b.args?(c.a=b.args,c):(b.dynamicArgs&&(c.d=new a(b.dynamicArgs).toJSON()),c)}}(od),qd=function(a,b,c){return function(d){var e,f,g,h,i,j,k;if(this["json_"+d])return this["json_"+d];if(e=this.component?{t:a.COMPONENT,e:this.component}:{t:a.ELEMENT,e:this.tag},this.doctype&&(e.y=1),this.attributes&&this.attributes.length)for(e.a={},j=this.attributes.length,i=0;j>i;i+=1){if(k=this.attributes[i],f=k.name,e.a[f])throw new Error("You cannot have multiple attributes with the same name");g=null===k.value?null:k.value.toJSON(d),e.a[f]=g}if(this.items&&this.items.length&&(e.f=b(this.items,d)),this.proxies&&this.proxies.length)for(e.v={},j=this.proxies.length,i=0;j>i;i+=1)h=this.proxies[i],e.v[h.directiveType]=c(h);return this.intro&&(e.t1=c(this.intro)),this.outro&&(e.t2=c(this.outro)),this.decorator&&(e.o=c(this.decorator)),this["json_"+d]=e,e}}(k,hd,pd),rd=function(a,b){var c;return c="a abbr acronym address applet area b base basefont bdo big blockquote body br button caption center cite code col colgroup dd del dfn dir div dl dt em fieldset font form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins isindex kbd label legend li link map menu meta noframes noscript object ol p param pre q s samp script select small span strike strong style sub sup textarea title tt u ul var article aside audio bdi canvas command data datagrid datalist details embed eventsource figcaption figure footer header hgroup keygen mark meter nav output progress ruby rp rt section source summary time track video wbr".split(" "),function(){var d,e,f,g,h,i,j,k;if(void 0!==this.str)return this.str;if(this.component)return this.str=!1;if(-1===c.indexOf(this.tag.toLowerCase()))return this.str=!1;if(this.proxies||this.intro||this.outro||this.decorator)return this.str=!1;if(j=a(this.items),j===!1)return this.str=!1;if(k=-1!==b.indexOf(this.tag.toLowerCase()),d="<"+this.tag,this.attributes)for(e=0,f=this.attributes.length;f>e;e+=1){if(h=this.attributes[e].name,-1!==h.indexOf(":"))return this.str=!1;if("id"===h||"intro"===h||"outro"===h)return this.str=!1;if(g=" "+h,null!==this.attributes[e].value){if(i=this.attributes[e].value.toString(),i===!1)return this.str=!1;""!==i&&(g+="=",g+=/[\s"'=<>`]/.test(i)?'"'+i.replace(/"/g,"&quot;")+'"':i)}d+=g}return this.selfClosing&&!k?(d+="/>",this.str=d):(d+=">",k?this.str=d:(d+=j,d+="</"+this.tag+">",this.str=d))}}(gd,pc),sd=function(a,b,c,d,e,f,g,h,i,j,k){var l,m,n,o,p,q=/^\s+/,r=/\s+$/;return l=function(d,e,i){var j,l,m,n,o,s,t;if(e.pos+=1,s=function(a){return{name:a.name,value:a.value?new k(a.value):null}},this.tag=d.name,t=d.name.toLowerCase(),"rv-"===t.substr(0,3)&&(c('The "rv-" prefix for components has been deprecated. Support will be removed in a future version'),this.tag=this.tag.substring(3)),i=i||"pre"===t,d.attrs&&(m=g(d.attrs),l=m.attrs,n=m.proxies,e.options.sanitize&&e.options.sanitize.eventAttributes&&(l=l.filter(p)),l.length&&(this.attributes=l.map(s)),n.length&&(this.proxies=n.map(h)),m.intro&&(this.intro=h(m.intro)),m.outro&&(this.outro=h(m.outro)),m.decorator&&(this.decorator=h(m.decorator))),d.doctype&&(this.doctype=!0),d.selfClosing&&(this.selfClosing=!0),-1!==b.indexOf(t)&&(this.isVoid=!0),!this.selfClosing&&!this.isVoid){for(this.siblings=f[t],this.items=[],j=e.next();j&&j.mustacheType!==a.CLOSING;){if(j.type===a.TAG){if(j.closing){j.name.toLowerCase()===t&&(e.pos+=1);break}if(this.siblings&&-1!==this.siblings.indexOf(j.name.toLowerCase()))break}this.items[this.items.length]=e.getStub(),j=e.next()}i||(o=this.items[0],o&&o.type===a.TEXT&&(o.text=o.text.replace(q,""),o.text||this.items.shift()),o=this.items[this.items.length-1],o&&o.type===a.TEXT&&(o.text=o.text.replace(r,""),o.text||this.items.pop()))}},l.prototype={toJSON:i,toString:j},m="a abbr acronym address applet area b base basefont bdo big blockquote body br button caption center cite code col colgroup dd del dfn dir div dl dt em fieldset font form frame frameset h1 h2 h3 h4 h5 h6 head hr html i iframe img input ins isindex kbd label legend li link map menu meta noframes noscript object ol p param pre q s samp script select small span strike strong style sub sup textarea title tt u ul var article aside audio bdi canvas command data datagrid datalist details embed eventsource figcaption figure footer header hgroup keygen mark meter nav output progress ruby rp rt section source summary time track video wbr".split(" "),n="li dd rt rp optgroup option tbody tfoot tr td th".split(" "),o=/^on[a-zA-Z]/,p=function(a){var b=!o.test(a.name);return b},l}(k,pc,I,jc,gd,kd,ld,md,qd,rd,od),td=function(a,b){return function(a){return this.options.sanitize&&this.options.sanitize.elements&&-1!==this.options.sanitize.elements.indexOf(a.name.toLowerCase())?null:new b(a,this)}}(k,sd),ud=function(a,b,c,d,e){var f;return f=function(a,b){var c,d;for(this.tokens=a||[],this.pos=0,this.options=b,this.preserveWhitespace=b.preserveWhitespace,d=[];c=this.getStub();)d.push(c);this.result=e(d)},f.prototype={getStub:function(){var a=this.next();return a?this.getText(a)||this.getComment(a)||this.getMustache(a)||this.getElement(a):null},getText:a,getComment:b,getMustache:c,getElement:d,next:function(){return this.tokens[this.pos]}},f}(bd,dd,jd,td,hd),vd=function(a,b,c){var d,e,f,g,h;return e=/^\s*$/,f=/<!--\s*\{\{\s*>\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*}\}\s*-->/,g=/<!--\s*\{\{\s*\/\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*}\}\s*-->/,d=function(d,g){var i,j,k;return g=g||{},f.test(d)?h(d,g):(g.sanitize===!0&&(g.sanitize={elements:"applet base basefont body frame frameset head html isindex link meta noframes noscript object param script style title".split(" "),eventAttributes:!0}),i=a(d,g),g.preserveWhitespace||(k=i[0],k&&k.type===b.TEXT&&e.test(k.value)&&i.shift(),k=i[i.length-1],k&&k.type===b.TEXT&&e.test(k.value)&&i.pop()),j=new c(i,g).result,"string"==typeof j?[j]:j)},h=function(a,b){var c,e,h,i,j,k;for(h={},c="",e=a;j=f.exec(e);){if(i=j[1],c+=e.substr(0,j.index),e=e.substring(j.index+j[0].length),k=g.exec(e),!k||k[1]!==i)throw new Error("Inline partials must have a closing delimiter, and cannot be nested");h[i]=d(e.substr(0,k.index),b),e=e.substring(k.index+k[0].length)}return{main:d(c,b),partials:h}},d}(_c,k,ud),wd=function(a,b,c,d,e,f){var g,h,i,j;return g=function(d,g){var k,l,m;if(l=i(d,g))return l;if(b&&(k=document.getElementById(g),k&&"SCRIPT"===k.tagName)){if(!f)throw new Error(a.missingParser);h(f(k.innerHTML),g,e)}if(l=e[g],!l){if(m='Could not find descriptor for partial "'+g+'"',d.debug)throw new Error(m);return c(m),[]}return j(l)},i=function(b,c){var d;if(b.partials[c]){if("string"==typeof b.partials[c]){if(!f)throw new Error(a.missingParser);d=f(b.partials[c],b.parseOptions),h(d,c,b.partials)}return j(b.partials[c])}},h=function(a,b,c){var e;if(d(a)){c[b]=a.main;for(e in a.partials)a.partials.hasOwnProperty(e)&&(c[e]=a.partials[e])}else c[b]=a},j=function(a){return 1===a.length&&"string"==typeof a[0]?a[0]:a},g}(xc,f,I,w,yc,vd),xd=function(a,b,c){var d,e;return c.push(function(){e=c.DomFragment}),d=function(c,d){var f,g=this.parentFragment=c.parentFragment;if(this.type=a.PARTIAL,this.name=c.descriptor.r,this.index=c.index,!c.descriptor.r)throw new Error("Partials must have a static reference (no expressions). This may change in a future version of Ractive.");f=b(g.root,c.descriptor.r),this.fragment=new e({descriptor:f,root:g.root,pNode:g.pNode,contextStack:g.contextStack,owner:this}),d&&d.appendChild(this.fragment.docFrag)},d.prototype={firstNode:function(){return this.fragment.firstNode()},findNextNode:function(){return this.parentFragment.findNextNode(this)},detach:function(){return this.fragment.detach()},teardown:function(a){this.fragment.teardown(a)},toString:function(){return this.fragment.toString()},find:function(a){return this.fragment.find(a)},findAll:function(a,b){return this.fragment.findAll(a,b)},findComponent:function(a){return this.fragment.findComponent(a)},findAllComponents:function(a,b){return this.fragment.findAllComponents(a,b)}},d}(k,wd,Eb),yd=function(a){var b=function(b,c,d){this.parentFragment=b.parentFragment,this.component=b,this.key=c,this.fragment=new a({descriptor:d,root:b.root,owner:this,contextStack:b.parentFragment.contextStack}),this.selfUpdating=this.fragment.isSimple(),this.value=this.fragment.getValue()};return b.prototype={bubble:function(){this.selfUpdating?this.update():!this.deferred&&this.ready&&(this.root._deferred.attrs.push(this),this.deferred=!0)},update:function(){var a=this.fragment.getValue();this.component.instance.set(this.key,a),this.value=a},teardown:function(){this.fragment.teardown()}},b}(ac),zd=function(a,b,c,d){function e(e,f,g,h){var i,j,k,l,m;return k=e.root,l=e.parentFragment,"string"==typeof g?(j=b(g),j?j.value:g):null===g?!0:1===g.length&&g[0].t===a.INTERPOLATOR&&g[0].r?l.indexRefs&&void 0!==l.indexRefs[g[0].r]?l.indexRefs[g[0].r]:(m=c(k,g[0].r,l.contextStack)||g[0].r,h.push({childKeypath:f,parentKeypath:m}),k.get(m)):(i=new d(e,f,g),e.complexParameters.push(i),i.value)}return function(a,b,c){var d,f,g;d={},a.complexParameters=[];for(f in b)b.hasOwnProperty(f)&&(g=e(a,f,b[f],c),void 0!==g&&(d[f]=g));return d}}(k,Xb,y,yd),Ad=function(){return function(a,b,c,d,e){var f,g,h,i;return g=a.parentFragment,i=a.root,h={content:e||[]},f=new b({el:g.pNode.cloneNode(!1),data:c,partials:h,_parent:i,adaptors:i.adaptors}),f.component=a,a.instance=f,f.insert(d),f.fragment.pNode=g.pNode,f}}(),Bd=function(){function a(a,c,d){var e,f,g,h,i,j,k;e=a.root,f=a.instance,i=a.observers,j=e.observe(c,function(a){g||e._wrapped[c]||(h=!0,f.set(d,a),h=!1)},b),i.push(j),f.twoway&&(j=f.observe(d,function(a){h||(g=!0,e.set(c,a),g=!1)},b),i.push(j),k=f.get(d),void 0!==k&&e.set(c,k))}var b={init:!1,debug:!0};return function(b,c){var d,e;for(b.observers=[],e=c.length;e--;)d=c[e],a(b,d.parentKeypath,d.childKeypath)}}(),Cd=function(a){function b(b,d,e,f){if("string"!=typeof f){if(d.debug)throw new Error(c);return a(c),void 0}b.on(e,function(){var a=Array.prototype.slice.call(arguments);a.unshift(f),d.fire.apply(d,a)})}var c="Components currently only support simple events - you cannot include arguments. Sorry!";return function(a,c){var d;for(d in c)c.hasOwnProperty(d)&&b(a.instance,a.root,d,c[d])}}(I),Dd=function(){return function(a){var b,c;for(b=a.root;b;)(c=b._liveComponentQueries[a.name])&&c.push(a.instance),b=b._parent}}(),Ed=function(a,b,c,d,e,f,g){return function(h,i,j){var k,l,m,n,o;if(k=h.parentFragment=i.parentFragment,l=k.root,h.root=l,h.type=a.COMPONENT,h.name=i.descriptor.e,h.index=i.index,h.observers=[],m=l.components[i.descriptor.e],!m)throw new Error('Component "'+i.descriptor.e+'" not found');o=[],n=c(h,i.descriptor.a,o),d(h,m,n,j,i.descriptor.f),e(h,o),f(h,i.descriptor.v),(i.descriptor.t1||i.descriptor.t2||i.descriptor.o)&&b('The "intro", "outro" and "decorator" directives have no effect on components'),g(h)}}(k,I,zd,Ad,Bd,Cd,Dd),Fd=function(a){var b=function(b,c){a(this,b,c)};return b.prototype={firstNode:function(){return this.instance.fragment.firstNode()},findNextNode:function(){return this.parentFragment.findNextNode(this)},detach:function(){return this.instance.fragment.detach()},teardown:function(){for(var a;this.complexParameters.length;)this.complexParameters.pop().teardown();for(;this.observers.length;)this.observers.pop().cancel();(a=this.root._liveComponentQueries[this.name])&&a._remove(this),this.instance.teardown()},toString:function(){return this.instance.fragment.toString()},find:function(a){return this.instance.fragment.find(a)},findAll:function(a,b){return this.instance.fragment.findAll(a,b)},findComponent:function(a){return a&&a!==this.name?null:this.instance},findAllComponents:function(a,b){b._test(this,!0),this.instance.fragment&&this.instance.fragment.findAllComponents(a,b)}},b}(Ed),Gd=function(a){var b=function(b,c){this.type=a.COMMENT,this.descriptor=b.descriptor,c&&(this.node=document.createComment(b.descriptor.f),c.appendChild(this.node))};return b.prototype={detach:function(){return this.node.parentNode.removeChild(this.node),this.node},teardown:function(a){a&&this.detach()},firstNode:function(){return this.node},toString:function(){return"<!--"+this.descriptor.f+"-->"}},b}(k),Hd=function(a,b,c,d,e,f,g,h,i,j,k,l,m){var n=function(a){a.pNode&&(this.docFrag=document.createDocumentFragment()),"string"==typeof a.descriptor?(this.html=a.descriptor,this.docFrag&&(this.nodes=d(this.html,a.pNode.tagName,this.docFrag))):c(this,a)};return n.prototype={detach:function(){var a,b;if(this.nodes)for(b=this.nodes.length;b--;)this.docFrag.appendChild(this.nodes[b]);else if(this.items)for(a=this.items.length,b=0;a>b;b+=1)this.docFrag.appendChild(this.items[b].detach());return this.docFrag},createItem:function(b){if("string"==typeof b.descriptor)return new e(b,this.docFrag);switch(b.descriptor.t){case a.INTERPOLATOR:return new f(b,this.docFrag);case a.SECTION:return new g(b,this.docFrag);case a.TRIPLE:return new h(b,this.docFrag);case a.ELEMENT:return this.root.components[b.descriptor.e]?new k(b,this.docFrag):new i(b,this.docFrag);case a.PARTIAL:return new j(b,this.docFrag);case a.COMMENT:return new l(b,this.docFrag);default:throw new Error("Something very strange happened. Please file an issue at https://github.com/RactiveJS/Ractive/issues. Thanks!")}},teardown:function(a){var b;if(this.nodes&&a)for(;b=this.nodes.pop();)b.parentNode.removeChild(b);else if(this.items)for(;this.items.length;)this.items.pop().teardown(a);this.nodes=this.items=this.docFrag=null},firstNode:function(){return this.items&&this.items[0]?this.items[0].firstNode():this.nodes?this.nodes[0]||null:null},findNextNode:function(a){var b=a.index;return this.items[b+1]?this.items[b+1].firstNode():this.owner===this.root?this.owner.component?this.owner.component.findNextNode():null:this.owner.findNextNode(this)},toString:function(){var a,b,c,d;if(this.html)return this.html;if(a="",!this.items)return a;for(c=this.items.length,b=0;c>b;b+=1)d=this.items[b],a+=d.toString();return a},find:function(a){var c,d,e,f,g;if(this.nodes){for(d=this.nodes.length,c=0;d>c;c+=1)if(f=this.nodes[c],1===f.nodeType){if(b(f,a))return f;if(g=f.querySelector(a))return g}return null}if(this.items){for(d=this.items.length,c=0;d>c;c+=1)if(e=this.items[c],e.find&&(g=e.find(a)))return g;return null}},findAll:function(a,c){var d,e,f,g,h,i,j;if(this.nodes){for(e=this.nodes.length,d=0;e>d;d+=1)if(g=this.nodes[d],1===g.nodeType&&(b(g,a)&&c.push(g),h=g.querySelectorAll(a)))for(i=h.length,j=0;i>j;j+=1)c.push(h[j])}else if(this.items)for(e=this.items.length,d=0;e>d;d+=1)f=this.items[d],f.findAll&&f.findAll(a,c);return c},findComponent:function(a){var b,c,d,e;if(this.items){for(b=this.items.length,c=0;b>c;c+=1)if(d=this.items[c],d.findComponent&&(e=d.findComponent(a)))return e;return null}},findAllComponents:function(a,b){var c,d,e;if(this.items)for(d=this.items.length,c=0;d>c;c+=1)e=this.items[c],e.findAllComponents&&e.findAllComponents(a,b);return b}},m.DomFragment=n,n}(k,Z,kb,lb,mb,zb,Fb,Gb,wc,xd,Fd,Gd,Eb),Id=function(a,b,c,d,e){return function(a,f){var g;if(!this._initing)throw new Error("You cannot call ractive.render() directly!");this._transitionManager=g=b(this,f),this.fragment=new e({descriptor:this.template,root:this,owner:this,pNode:a}),c(this),a&&a.appendChild(this.fragment.docFrag),d(this),this._transitionManager=null,g.ready(),this.rendered=!0}}(jb,q,o,p,Hd),Jd=function(a){return function(){return a("renderHTML() has been deprecated and will be removed in a future version. Please use toHTML() instead"),this.toHTML()}}(I),Kd=function(){return function(){return this.fragment.toString()}}(),Ld=function(a,b){return function(c){var d,e,f;for(this.fire("teardown"),f=this._transitionManager,this._transitionManager=e=a(this,c),this.fragment.teardown(!0);this._animations[0];)this._animations[0].stop();for(d in this._cache)b(this,d);this._transitionManager=f,e.ready()}}(q,m),Md=function(a){return function(b,c,d){var e;if("string"==typeof c&&a(d)){if(e=b.get(c),void 0===e&&(e=0),a(e))b.set(c,e+d);else if(b.debug)throw new Error("Cannot add to a non-numeric value")}else if(b.debug)throw new Error("Bad arguments")}}(J),Nd=function(a){return function(b,c){a(this,b,void 0===c?1:c)}}(Md),Od=function(a){return function(b,c){a(this,b,void 0===c?-1:-c)}}(Md),Pd=function(){return function(a){var b;if("string"==typeof a)b=this.get(a),this.set(a,!b);else if(this.debug)throw new Error("Bad arguments")}}(),Qd=function(){return function(a,b){var c,d,e,f,g;return c={},e=0,d=function(a,d){var f,h,i;h=e,i=b.length;do{if(f=b.indexOf(a,h),-1===f)return g=!0,-1;h=f+1}while(c[f]&&i>h);return f===e&&(e+=1),f!==d&&(g=!0),c[f]=!0,f},f=a.map(d),f.unchanged=!g,f}}(),Rd=function(a){return function(b,c,d,e){var f,g;for(f=c.length;f--;)g=c[f],g.type===a.REFERENCE?g.update():g.keypath===b&&g.type===a.SECTION&&!g.inverted&&g.docFrag?d[d.length]=g:e[e.length]=g}}(k),Sd=function(a,b,c,d,e,f,g,h,i,j){function k(a){return JSON.stringify(a)}function l(a){return m[a]||(m[a]=function(b){return b[a]}),m[a]}var m={};return function(m,n,o){var p,q,r,s,t,u,v,w,x,y,z,A,B,C,D;if(p=this.get(m),!b(p)||!b(n))return this.set(m,n,o&&o.complete);if(t=p.length===n.length,o&&o.compare){if(o.compare===!0)s=k;else if("string"==typeof o.compare)s=l(o.compare);else{if("function"!=typeof o.compare)throw new Error("The `compare` option must be a function, or a string representing an identifying field (or `true` to use JSON.stringify)");s=o.compare}try{q=p.map(s),r=n.map(s)}catch(E){if(this.debug)throw E;a("Merge operation: comparison failed. Falling back to identity checking"),q=p,r=n}}else q=p,r=n;if(v=i(q,r),c(this,m),h(this,m,n),!v.unchanged||!t){for(B=this._transitionManager,this._transitionManager=A=f(this,o&&o.complete),w=[],x=[],u=0;u<this._deps.length;u+=1)if(y=this._deps[u],y&&(z=y[m])){for(j(m,z,w,x),d(this);w.length;)w.pop().merge(v);for(;x.length;)x.pop().update()}for(e(this),C=[],D=m.split(".");D.length;)D.pop(),C[C.length]=D.join(".");g.multiple(this,C,!0),q.length!==r.length&&g(this,m+".length",!0),this._transitionManager=B,A.ready()}}}(I,l,m,o,A,q,r,B,Qd,Rd),Td=function(){return function(){return this.fragment.detach()}}(),Ud=function(a){return function(b,c){if(b=a(b),c=a(c)||null,!b)throw new Error("You must specify a valid target to insert into");b.insertBefore(this.detach(),c),this.fragment.pNode=b}}(jb),Vd=function(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w){return{get:a,set:b,update:c,updateModel:d,animate:e,on:f,off:g,observe:h,fire:i,find:j,findAll:k,findComponent:l,findAllComponents:m,renderHTML:o,toHTML:p,render:n,teardown:q,add:r,subtract:s,toggle:t,merge:u,detach:v,insert:w}}(v,C,D,F,N,O,P,W,X,Y,gb,hb,ib,Id,Jd,Kd,Ld,Nd,Od,Pd,Sd,Td,Ud),Wd=function(){return["partials","transitions","events","components","decorators","data"]}(),Xd=function(){return["el","template","complete","modifyArrays","magic","twoway","lazy","append","preserveWhitespace","sanitize","stripComments","noIntro","transitionsEnabled","adaptors"]}(),Yd=function(a,b,c){return function(d,e){a.forEach(function(a){e[a]&&(d[a]=c(e[a]))}),b.forEach(function(a){d[a]=e[a]})}}(Wd,Xd,c),Zd=function(){return function(a,b){return/_super/.test(a)?function(){var c,d=this._super;return this._super=b,c=a.apply(this,arguments),this._super=d,c}:a}}(),$d=function(){return function(a,b){var c;for(c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a}}(),_d=function(a,b,c,d){var e,f;return e=a.concat(b),f={},e.forEach(function(a){f[a]=!0}),function(e,g){var h,i;a.forEach(function(a){var b=g[a];b&&(e[a]?d(e[a],b):e[a]=b)}),b.forEach(function(a){var b=g[a];void 0!==b&&(e[a]="function"==typeof b&&"function"==typeof e[a]?c(b,e[a]):g[a])});for(h in g)g.hasOwnProperty(h)&&!f[h]&&(i=g[h],e.prototype[h]="function"==typeof i&&"function"==typeof e.prototype[h]?c(i,e.prototype[h]):i)}}(Wd,Xd,Zd,$d),ae=function(a,b){return function(c,d){a(c.template)&&(c.partials||(c.partials={}),b(c.partials,c.template.partials),d.partials&&b(c.partials,d.partials),c.template=c.template.main)}}(w,$d),be=function(a,b,c){return function(d){var e;if("string"==typeof d.template){if(!c)throw new Error(a.missingParser);if("#"===d.template.charAt(0)&&b){if(e=document.getElementById(d.template.substring(1)),!e||"SCRIPT"!==e.tagName)throw new Error("Could not find template element ("+d.template+")");d.template=c(e.innerHTML,d)}else d.template=c(d.template,d)}}}(xc,f,vd),ce=function(a,b){return function(c){var d;if(c.partials)for(d in c.partials)if(c.partials.hasOwnProperty(d)&&"string"==typeof c.partials[d]){if(!b)throw new Error(a.missingParser);c.partials[d]=b(c.partials[d],c)}}}(xc,vd),de=function(){return function(a){var b,c={};for(b in a)a.hasOwnProperty(b)&&(c[b]=a[b]);return c}}(),ee=function(){return function(a){for(var b,c,d=Array.prototype.slice.call(arguments,1);c=d.shift();)for(b in c)c.hasOwnProperty(b)&&(a[b]=c[b]);return a}}(),fe=function(a,b,c,d,e,f,g,h,i,j,k){var l,m,n,o;return l=function(){return{}},m=function(){return[]},n=d(null),g(n,{preserveWhitespace:{enumerable:!0,value:!1},append:{enumerable:!0,value:!1},twoway:{enumerable:!0,value:!0},modifyArrays:{enumerable:!0,value:!0},data:{enumerable:!0,value:l},lazy:{enumerable:!0,value:!1},debug:{enumerable:!0,value:!1},transitions:{enumerable:!0,value:l},decorators:{enumerable:!0,value:l},events:{enumerable:!0,value:l},noIntro:{enumerable:!0,value:!1},transitionsEnabled:{enumerable:!0,value:!0},magic:{enumerable:!0,value:!1},adaptors:{enumerable:!0,value:m}}),o=["components","decorators","events","partials","transitions","data"],function(l,m){var p,q,r,s;for(p in n)void 0===m[p]&&(m[p]="function"==typeof n[p]?n[p]():n[p]);if(g(l,{_initing:{value:!0,writable:!0},_guid:{value:"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(a){var b,c;return b=16*Math.random()|0,c="x"==a?b:3&b|8,c.toString(16)})},_subs:{value:d(null),configurable:!0},_cache:{value:{}},_cacheMap:{value:d(null)},_deps:{value:[]},_depsMap:{value:d(null)},_patternObservers:{value:[]},_pendingResolution:{value:[]},_deferred:{value:{}},_evaluators:{value:d(null)},_twowayBindings:{value:{}},_transitionManager:{value:null,writable:!0},_animations:{value:[]},nodes:{value:{}},_wrapped:{value:d(null)},_liveQueries:{value:[]},_liveComponentQueries:{value:[]}}),g(l._deferred,{attrs:{value:[]},evals:{value:[]},selectValues:{value:[]},checkboxes:{value:[]},radios:{value:[]},observers:{value:[]},transitions:{value:[]},liveQueries:{value:[]},decorators:{value:[]},focusable:{value:null,writable:!0}}),l.adaptors=m.adaptors,l.modifyArrays=m.modifyArrays,l.magic=m.magic,l.twoway=m.twoway,l.lazy=m.lazy,l.debug=m.debug,l.magic&&!j)throw new Error("Getters and setters (magic mode) are not supported in this browser");if(m._parent&&f(l,"_parent",{value:m._parent}),m.el&&(l.el=h(m.el),!l.el&&l.debug))throw new Error("Could not find container element");if(m.eventDefinitions&&(c("ractive.eventDefinitions has been deprecated in favour of ractive.events. Support will be removed in future versions"),m.events=m.eventDefinitions),o.forEach(function(a){l.constructor[a]?l[a]=e(d(l.constructor[a]||{}),m[a]):m[a]&&(l[a]=m[a])}),q=m.template,"string"==typeof q){if(!k)throw new Error(b.missingParser);if("#"===q.charAt(0)&&a){if(r=document.getElementById(q.substring(1)),!r)throw new Error("Could not find template element ("+q+")");s=k(r.innerHTML,m)}else s=k(q,m)}else s=q;i(s)&&(e(l.partials,s.partials),s=s.main),s&&1===s.length&&"string"==typeof s[0]&&(s=s[0]),l.template=s,e(l.partials,m.partials),l.parseOptions={preserveWhitespace:m.preserveWhitespace,sanitize:m.sanitize,stripComments:m.stripComments},l.transitionsEnabled=m.noIntro?!1:m.transitionsEnabled,a&&!l.el&&(l.el=document.createDocumentFragment()),l.el&&!m.append&&(l.el.innerHTML=""),l.render(l.el,m.complete),l.transitionsEnabled=m.transitionsEnabled,l._initing=!1}}(f,xc,I,c,ee,g,h,jb,w,t,vd),ge=function(a,b,c,d,e){return function(a,c,f){b.forEach(function(a){var b=f[a],e=c[a];"function"==typeof b&&"function"==typeof e?f[a]=d(b,e):void 0===b&&void 0!==e&&(f[a]=e)}),a.beforeInit&&a.beforeInit(f),e(a,f),a.init&&a.init(f)}}(kc,Xd,de,Zd,fe),he=function(a,b,c,d,e,f,g,h){var i;return h.push(function(){i=h.Ractive}),function(h){var i,j=this;return i=function(a){g(this,i,a||{})},i.prototype=a(j.prototype),i.prototype.constructor=i,b(i,j),c(i,h),e(i),d(i,h),f(i),i.extend=j.extend,i}}(c,Yd,_d,ae,be,ce,ge,Eb),ie=function(a,b,c,d,e,f,g,h,i,j,k){var l=function(a){j(this,a)};return c(l,{prototype:{value:d},partials:{value:e},adaptors:{value:f},easing:{value:g},transitions:{value:{}},events:{value:{}},components:{value:{}},decorators:{value:{}},svg:{value:a},VERSION:{value:"0.3.9"}}),l.eventDefinitions=l.events,l.prototype.constructor=l,l.delimiters=["{{","}}"],l.tripleDelimiters=["{{{","}}}"],l.extend=h,l.parse=i,k.Ractive=l,l}(b,c,h,Vd,yc,j,M,he,vd,fe,Eb),je=function(a,b){for("undefined"!=typeof window&&window.Node&&!window.Node.prototype.contains&&window.HTMLElement&&window.HTMLElement.prototype.contains&&(window.Node.prototype.contains=window.HTMLElement.prototype.contains);b.length;)b.pop()();return a}(ie,Eb);"undefined"!=typeof module&&module.exports?module.exports=je:"function"==typeof define&&define.amd?define('Ractive',[],function(){return je}):a.Ractive=je}("undefined"!=typeof window?window:this);
!function(a,b){if("undefined"!=typeof module&&module.exports&&"function"==typeof require)b(require("ractive"),require("backbone"));else if("function"==typeof define&&define.amd)define('Ractive-Backbone',["Ractive","Backbone"],b);else{if(!a.Ractive||!a.Backbone)throw new Error("Could not find Ractive or Backbone! Both must be loaded before the Ractive-Backbone plugin");b(a.Ractive,a.Backbone)}}("undefined"!=typeof window?window:this,function(a,b){var c,d;if(!a||!b)throw new Error("Could not find Ractive or Backbone! Check your paths config");a.adaptors.Backbone={filter:function(a){return a instanceof b.Model||a instanceof b.Collection},wrap:function(a,e,f,g){return e instanceof b.Model?new c(a,e,f,g):new d(a,e,f,g)}},c=function(a,b,c,d){var e=this;this.value=b,b.on("change",this.modelChangeHandler=function(){e.setting=!0,a.set(d(b.changed)),e.setting=!1})},c.prototype={teardown:function(){this.value.off("change",this.changeHandler)},get:function(){return this.value.attributes},set:function(a,b){this.setting||-1!==a.indexOf(".")||this.value.set(a,b)},reset:function(a){return a instanceof b.Model||"object"!=typeof a?!1:(this.value.reset(a),void 0)}},d=function(a,b,c){var d=this;this.value=b,b.on("add remove reset sort",this.changeHandler=function(){d.setting=!0,a.set(c,b.models),d.setting=!1})},d.prototype={teardown:function(){this.value.off("add remove reset sort",this.changeHandler)},get:function(){return this.value.models},reset:function(a){return this.setting?void 0:a instanceof b.Collection||"[object Array]"!==Object.prototype.toString.call(a)?!1:(this.value.reset(a),void 0)}}});
!function(a,b){if("undefined"!=typeof module&&module.exports&&"function"==typeof require)b(require("ractive"));else if("function"==typeof define&&define.amd)define('Ractive-events-tap',["Ractive"],b);else{if(!a.Ractive)throw new Error("Could not find Ractive! It must be loaded before the Ractive-events-tap plugin");b(a.Ractive)}}("undefined"!=typeof window?window:this,function(a){var b=function(a,b){var c,d,e,f,g;return f=5,g=400,c=function(c){var d,e,h,i,j,k,l;(void 0===c.which||1===c.which)&&(e=c.clientX,h=c.clientY,d=this,i=c.pointerId,j=function(a){a.pointerId==i&&(b({node:d,original:a}),l())},k=function(a){a.pointerId==i&&(Math.abs(a.clientX-e)>=f||Math.abs(a.clientY-h)>=f)&&l()},l=function(){a.removeEventListener("MSPointerUp",j,!1),document.removeEventListener("MSPointerMove",k,!1),document.removeEventListener("MSPointerCancel",l,!1),a.removeEventListener("pointerup",j,!1),document.removeEventListener("pointermove",k,!1),document.removeEventListener("pointercancel",l,!1),a.removeEventListener("click",j,!1),document.removeEventListener("mousemove",k,!1)},window.navigator.pointerEnabled?(a.addEventListener("pointerup",j,!1),document.addEventListener("pointermove",k,!1),document.addEventListener("pointercancel",l,!1)):window.navigator.msPointerEnabled?(a.addEventListener("MSPointerUp",j,!1),document.addEventListener("MSPointerMove",k,!1),document.addEventListener("MSPointerCancel",l,!1)):(a.addEventListener("click",j,!1),document.addEventListener("mousemove",k,!1)),setTimeout(l,g))},window.navigator.pointerEnabled?a.addEventListener("pointerdown",c,!1):window.navigator.msPointerEnabled?a.addEventListener("MSPointerDown",c,!1):a.addEventListener("mousedown",c,!1),d=function(c){var d,e,h,i,j,k,l,m;1===c.touches.length&&(i=c.touches[0],e=i.clientX,h=i.clientY,d=this,j=i.identifier,l=function(a){var c;c=a.changedTouches[0],c.identifier!==j&&m(),a.preventDefault(),b({node:d,original:a}),m()},k=function(a){var b;(1!==a.touches.length||a.touches[0].identifier!==j)&&m(),b=a.touches[0],(Math.abs(b.clientX-e)>=f||Math.abs(b.clientY-h)>=f)&&m()},m=function(){a.removeEventListener("touchend",l,!1),window.removeEventListener("touchmove",k,!1),window.removeEventListener("touchcancel",m,!1)},a.addEventListener("touchend",l,!1),window.addEventListener("touchmove",k,!1),window.addEventListener("touchcancel",m,!1),setTimeout(m,g))},a.addEventListener("touchstart",d,!1),("BUTTON"===a.tagName||"button"===a.type)&&(e=function(){var c,d;d=function(c){32===c.which&&b({node:a,original:c})},c=function(){a.removeEventListener("keydown",d,!1),a.removeEventListener("blur",c,!1)},a.addEventListener("keydown",d,!1),a.addEventListener("blur",c,!1)},a.addEventListener("focus",e,!1)),{teardown:function(){a.removeEventListener("pointerdown",c,!1),a.removeEventListener("MSPointerDown",c,!1),a.removeEventListener("mousedown",c,!1),a.removeEventListener("touchstart",d,!1),a.removeEventListener("focus",e,!1)}}};a.events.tap=b});
//! moment.js
//! version : 2.5.1
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com
(function(a){function b(){return{empty:!1,unusedTokens:[],unusedInput:[],overflow:-2,charsLeftOver:0,nullInput:!1,invalidMonth:null,invalidFormat:!1,userInvalidated:!1,iso:!1}}function c(a,b){return function(c){return k(a.call(this,c),b)}}function d(a,b){return function(c){return this.lang().ordinal(a.call(this,c),b)}}function e(){}function f(a){w(a),h(this,a)}function g(a){var b=q(a),c=b.year||0,d=b.month||0,e=b.week||0,f=b.day||0,g=b.hour||0,h=b.minute||0,i=b.second||0,j=b.millisecond||0;this._milliseconds=+j+1e3*i+6e4*h+36e5*g,this._days=+f+7*e,this._months=+d+12*c,this._data={},this._bubble()}function h(a,b){for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return b.hasOwnProperty("toString")&&(a.toString=b.toString),b.hasOwnProperty("valueOf")&&(a.valueOf=b.valueOf),a}function i(a){var b,c={};for(b in a)a.hasOwnProperty(b)&&qb.hasOwnProperty(b)&&(c[b]=a[b]);return c}function j(a){return 0>a?Math.ceil(a):Math.floor(a)}function k(a,b,c){for(var d=""+Math.abs(a),e=a>=0;d.length<b;)d="0"+d;return(e?c?"+":"":"-")+d}function l(a,b,c,d){var e,f,g=b._milliseconds,h=b._days,i=b._months;g&&a._d.setTime(+a._d+g*c),(h||i)&&(e=a.minute(),f=a.hour()),h&&a.date(a.date()+h*c),i&&a.month(a.month()+i*c),g&&!d&&db.updateOffset(a),(h||i)&&(a.minute(e),a.hour(f))}function m(a){return"[object Array]"===Object.prototype.toString.call(a)}function n(a){return"[object Date]"===Object.prototype.toString.call(a)||a instanceof Date}function o(a,b,c){var d,e=Math.min(a.length,b.length),f=Math.abs(a.length-b.length),g=0;for(d=0;e>d;d++)(c&&a[d]!==b[d]||!c&&s(a[d])!==s(b[d]))&&g++;return g+f}function p(a){if(a){var b=a.toLowerCase().replace(/(.)s$/,"$1");a=Tb[a]||Ub[b]||b}return a}function q(a){var b,c,d={};for(c in a)a.hasOwnProperty(c)&&(b=p(c),b&&(d[b]=a[c]));return d}function r(b){var c,d;if(0===b.indexOf("week"))c=7,d="day";else{if(0!==b.indexOf("month"))return;c=12,d="month"}db[b]=function(e,f){var g,h,i=db.fn._lang[b],j=[];if("number"==typeof e&&(f=e,e=a),h=function(a){var b=db().utc().set(d,a);return i.call(db.fn._lang,b,e||"")},null!=f)return h(f);for(g=0;c>g;g++)j.push(h(g));return j}}function s(a){var b=+a,c=0;return 0!==b&&isFinite(b)&&(c=b>=0?Math.floor(b):Math.ceil(b)),c}function t(a,b){return new Date(Date.UTC(a,b+1,0)).getUTCDate()}function u(a){return v(a)?366:365}function v(a){return a%4===0&&a%100!==0||a%400===0}function w(a){var b;a._a&&-2===a._pf.overflow&&(b=a._a[jb]<0||a._a[jb]>11?jb:a._a[kb]<1||a._a[kb]>t(a._a[ib],a._a[jb])?kb:a._a[lb]<0||a._a[lb]>23?lb:a._a[mb]<0||a._a[mb]>59?mb:a._a[nb]<0||a._a[nb]>59?nb:a._a[ob]<0||a._a[ob]>999?ob:-1,a._pf._overflowDayOfYear&&(ib>b||b>kb)&&(b=kb),a._pf.overflow=b)}function x(a){return null==a._isValid&&(a._isValid=!isNaN(a._d.getTime())&&a._pf.overflow<0&&!a._pf.empty&&!a._pf.invalidMonth&&!a._pf.nullInput&&!a._pf.invalidFormat&&!a._pf.userInvalidated,a._strict&&(a._isValid=a._isValid&&0===a._pf.charsLeftOver&&0===a._pf.unusedTokens.length)),a._isValid}function y(a){return a?a.toLowerCase().replace("_","-"):a}function z(a,b){return b._isUTC?db(a).zone(b._offset||0):db(a).local()}function A(a,b){return b.abbr=a,pb[a]||(pb[a]=new e),pb[a].set(b),pb[a]}function B(a){delete pb[a]}function C(a){var b,c,d,e,f=0,g=function(a){if(!pb[a]&&rb)try{require("./lang/"+a)}catch(b){}return pb[a]};if(!a)return db.fn._lang;if(!m(a)){if(c=g(a))return c;a=[a]}for(;f<a.length;){for(e=y(a[f]).split("-"),b=e.length,d=y(a[f+1]),d=d?d.split("-"):null;b>0;){if(c=g(e.slice(0,b).join("-")))return c;if(d&&d.length>=b&&o(e,d,!0)>=b-1)break;b--}f++}return db.fn._lang}function D(a){return a.match(/\[[\s\S]/)?a.replace(/^\[|\]$/g,""):a.replace(/\\/g,"")}function E(a){var b,c,d=a.match(vb);for(b=0,c=d.length;c>b;b++)d[b]=Yb[d[b]]?Yb[d[b]]:D(d[b]);return function(e){var f="";for(b=0;c>b;b++)f+=d[b]instanceof Function?d[b].call(e,a):d[b];return f}}function F(a,b){return a.isValid()?(b=G(b,a.lang()),Vb[b]||(Vb[b]=E(b)),Vb[b](a)):a.lang().invalidDate()}function G(a,b){function c(a){return b.longDateFormat(a)||a}var d=5;for(wb.lastIndex=0;d>=0&&wb.test(a);)a=a.replace(wb,c),wb.lastIndex=0,d-=1;return a}function H(a,b){var c,d=b._strict;switch(a){case"DDDD":return Ib;case"YYYY":case"GGGG":case"gggg":return d?Jb:zb;case"Y":case"G":case"g":return Lb;case"YYYYYY":case"YYYYY":case"GGGGG":case"ggggg":return d?Kb:Ab;case"S":if(d)return Gb;case"SS":if(d)return Hb;case"SSS":if(d)return Ib;case"DDD":return yb;case"MMM":case"MMMM":case"dd":case"ddd":case"dddd":return Cb;case"a":case"A":return C(b._l)._meridiemParse;case"X":return Fb;case"Z":case"ZZ":return Db;case"T":return Eb;case"SSSS":return Bb;case"MM":case"DD":case"YY":case"GG":case"gg":case"HH":case"hh":case"mm":case"ss":case"ww":case"WW":return d?Hb:xb;case"M":case"D":case"d":case"H":case"h":case"m":case"s":case"w":case"W":case"e":case"E":return xb;default:return c=new RegExp(P(O(a.replace("\\","")),"i"))}}function I(a){a=a||"";var b=a.match(Db)||[],c=b[b.length-1]||[],d=(c+"").match(Qb)||["-",0,0],e=+(60*d[1])+s(d[2]);return"+"===d[0]?-e:e}function J(a,b,c){var d,e=c._a;switch(a){case"M":case"MM":null!=b&&(e[jb]=s(b)-1);break;case"MMM":case"MMMM":d=C(c._l).monthsParse(b),null!=d?e[jb]=d:c._pf.invalidMonth=b;break;case"D":case"DD":null!=b&&(e[kb]=s(b));break;case"DDD":case"DDDD":null!=b&&(c._dayOfYear=s(b));break;case"YY":e[ib]=s(b)+(s(b)>68?1900:2e3);break;case"YYYY":case"YYYYY":case"YYYYYY":e[ib]=s(b);break;case"a":case"A":c._isPm=C(c._l).isPM(b);break;case"H":case"HH":case"h":case"hh":e[lb]=s(b);break;case"m":case"mm":e[mb]=s(b);break;case"s":case"ss":e[nb]=s(b);break;case"S":case"SS":case"SSS":case"SSSS":e[ob]=s(1e3*("0."+b));break;case"X":c._d=new Date(1e3*parseFloat(b));break;case"Z":case"ZZ":c._useUTC=!0,c._tzm=I(b);break;case"w":case"ww":case"W":case"WW":case"d":case"dd":case"ddd":case"dddd":case"e":case"E":a=a.substr(0,1);case"gg":case"gggg":case"GG":case"GGGG":case"GGGGG":a=a.substr(0,2),b&&(c._w=c._w||{},c._w[a]=b)}}function K(a){var b,c,d,e,f,g,h,i,j,k,l=[];if(!a._d){for(d=M(a),a._w&&null==a._a[kb]&&null==a._a[jb]&&(f=function(b){var c=parseInt(b,10);return b?b.length<3?c>68?1900+c:2e3+c:c:null==a._a[ib]?db().weekYear():a._a[ib]},g=a._w,null!=g.GG||null!=g.W||null!=g.E?h=Z(f(g.GG),g.W||1,g.E,4,1):(i=C(a._l),j=null!=g.d?V(g.d,i):null!=g.e?parseInt(g.e,10)+i._week.dow:0,k=parseInt(g.w,10)||1,null!=g.d&&j<i._week.dow&&k++,h=Z(f(g.gg),k,j,i._week.doy,i._week.dow)),a._a[ib]=h.year,a._dayOfYear=h.dayOfYear),a._dayOfYear&&(e=null==a._a[ib]?d[ib]:a._a[ib],a._dayOfYear>u(e)&&(a._pf._overflowDayOfYear=!0),c=U(e,0,a._dayOfYear),a._a[jb]=c.getUTCMonth(),a._a[kb]=c.getUTCDate()),b=0;3>b&&null==a._a[b];++b)a._a[b]=l[b]=d[b];for(;7>b;b++)a._a[b]=l[b]=null==a._a[b]?2===b?1:0:a._a[b];l[lb]+=s((a._tzm||0)/60),l[mb]+=s((a._tzm||0)%60),a._d=(a._useUTC?U:T).apply(null,l)}}function L(a){var b;a._d||(b=q(a._i),a._a=[b.year,b.month,b.day,b.hour,b.minute,b.second,b.millisecond],K(a))}function M(a){var b=new Date;return a._useUTC?[b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()]:[b.getFullYear(),b.getMonth(),b.getDate()]}function N(a){a._a=[],a._pf.empty=!0;var b,c,d,e,f,g=C(a._l),h=""+a._i,i=h.length,j=0;for(d=G(a._f,g).match(vb)||[],b=0;b<d.length;b++)e=d[b],c=(h.match(H(e,a))||[])[0],c&&(f=h.substr(0,h.indexOf(c)),f.length>0&&a._pf.unusedInput.push(f),h=h.slice(h.indexOf(c)+c.length),j+=c.length),Yb[e]?(c?a._pf.empty=!1:a._pf.unusedTokens.push(e),J(e,c,a)):a._strict&&!c&&a._pf.unusedTokens.push(e);a._pf.charsLeftOver=i-j,h.length>0&&a._pf.unusedInput.push(h),a._isPm&&a._a[lb]<12&&(a._a[lb]+=12),a._isPm===!1&&12===a._a[lb]&&(a._a[lb]=0),K(a),w(a)}function O(a){return a.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g,function(a,b,c,d,e){return b||c||d||e})}function P(a){return a.replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&")}function Q(a){var c,d,e,f,g;if(0===a._f.length)return a._pf.invalidFormat=!0,a._d=new Date(0/0),void 0;for(f=0;f<a._f.length;f++)g=0,c=h({},a),c._pf=b(),c._f=a._f[f],N(c),x(c)&&(g+=c._pf.charsLeftOver,g+=10*c._pf.unusedTokens.length,c._pf.score=g,(null==e||e>g)&&(e=g,d=c));h(a,d||c)}function R(a){var b,c,d=a._i,e=Mb.exec(d);if(e){for(a._pf.iso=!0,b=0,c=Ob.length;c>b;b++)if(Ob[b][1].exec(d)){a._f=Ob[b][0]+(e[6]||" ");break}for(b=0,c=Pb.length;c>b;b++)if(Pb[b][1].exec(d)){a._f+=Pb[b][0];break}d.match(Db)&&(a._f+="Z"),N(a)}else a._d=new Date(d)}function S(b){var c=b._i,d=sb.exec(c);c===a?b._d=new Date:d?b._d=new Date(+d[1]):"string"==typeof c?R(b):m(c)?(b._a=c.slice(0),K(b)):n(c)?b._d=new Date(+c):"object"==typeof c?L(b):b._d=new Date(c)}function T(a,b,c,d,e,f,g){var h=new Date(a,b,c,d,e,f,g);return 1970>a&&h.setFullYear(a),h}function U(a){var b=new Date(Date.UTC.apply(null,arguments));return 1970>a&&b.setUTCFullYear(a),b}function V(a,b){if("string"==typeof a)if(isNaN(a)){if(a=b.weekdaysParse(a),"number"!=typeof a)return null}else a=parseInt(a,10);return a}function W(a,b,c,d,e){return e.relativeTime(b||1,!!c,a,d)}function X(a,b,c){var d=hb(Math.abs(a)/1e3),e=hb(d/60),f=hb(e/60),g=hb(f/24),h=hb(g/365),i=45>d&&["s",d]||1===e&&["m"]||45>e&&["mm",e]||1===f&&["h"]||22>f&&["hh",f]||1===g&&["d"]||25>=g&&["dd",g]||45>=g&&["M"]||345>g&&["MM",hb(g/30)]||1===h&&["y"]||["yy",h];return i[2]=b,i[3]=a>0,i[4]=c,W.apply({},i)}function Y(a,b,c){var d,e=c-b,f=c-a.day();return f>e&&(f-=7),e-7>f&&(f+=7),d=db(a).add("d",f),{week:Math.ceil(d.dayOfYear()/7),year:d.year()}}function Z(a,b,c,d,e){var f,g,h=U(a,0,1).getUTCDay();return c=null!=c?c:e,f=e-h+(h>d?7:0)-(e>h?7:0),g=7*(b-1)+(c-e)+f+1,{year:g>0?a:a-1,dayOfYear:g>0?g:u(a-1)+g}}function $(a){var b=a._i,c=a._f;return null===b?db.invalid({nullInput:!0}):("string"==typeof b&&(a._i=b=C().preparse(b)),db.isMoment(b)?(a=i(b),a._d=new Date(+b._d)):c?m(c)?Q(a):N(a):S(a),new f(a))}function _(a,b){db.fn[a]=db.fn[a+"s"]=function(a){var c=this._isUTC?"UTC":"";return null!=a?(this._d["set"+c+b](a),db.updateOffset(this),this):this._d["get"+c+b]()}}function ab(a){db.duration.fn[a]=function(){return this._data[a]}}function bb(a,b){db.duration.fn["as"+a]=function(){return+this/b}}function cb(a){var b=!1,c=db;"undefined"==typeof ender&&(a?(gb.moment=function(){return!b&&console&&console.warn&&(b=!0,console.warn("Accessing Moment through the global scope is deprecated, and will be removed in an upcoming release.")),c.apply(null,arguments)},h(gb.moment,c)):gb.moment=db)}for(var db,eb,fb="2.5.1",gb=this,hb=Math.round,ib=0,jb=1,kb=2,lb=3,mb=4,nb=5,ob=6,pb={},qb={_isAMomentObject:null,_i:null,_f:null,_l:null,_strict:null,_isUTC:null,_offset:null,_pf:null,_lang:null},rb="undefined"!=typeof module&&module.exports&&"undefined"!=typeof require,sb=/^\/?Date\((\-?\d+)/i,tb=/(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,ub=/^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,vb=/(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|X|zz?|ZZ?|.)/g,wb=/(\[[^\[]*\])|(\\)?(LT|LL?L?L?|l{1,4})/g,xb=/\d\d?/,yb=/\d{1,3}/,zb=/\d{1,4}/,Ab=/[+\-]?\d{1,6}/,Bb=/\d+/,Cb=/[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i,Db=/Z|[\+\-]\d\d:?\d\d/gi,Eb=/T/i,Fb=/[\+\-]?\d+(\.\d{1,3})?/,Gb=/\d/,Hb=/\d\d/,Ib=/\d{3}/,Jb=/\d{4}/,Kb=/[+-]?\d{6}/,Lb=/[+-]?\d+/,Mb=/^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,Nb="YYYY-MM-DDTHH:mm:ssZ",Ob=[["YYYYYY-MM-DD",/[+-]\d{6}-\d{2}-\d{2}/],["YYYY-MM-DD",/\d{4}-\d{2}-\d{2}/],["GGGG-[W]WW-E",/\d{4}-W\d{2}-\d/],["GGGG-[W]WW",/\d{4}-W\d{2}/],["YYYY-DDD",/\d{4}-\d{3}/]],Pb=[["HH:mm:ss.SSSS",/(T| )\d\d:\d\d:\d\d\.\d{1,3}/],["HH:mm:ss",/(T| )\d\d:\d\d:\d\d/],["HH:mm",/(T| )\d\d:\d\d/],["HH",/(T| )\d\d/]],Qb=/([\+\-]|\d\d)/gi,Rb="Date|Hours|Minutes|Seconds|Milliseconds".split("|"),Sb={Milliseconds:1,Seconds:1e3,Minutes:6e4,Hours:36e5,Days:864e5,Months:2592e6,Years:31536e6},Tb={ms:"millisecond",s:"second",m:"minute",h:"hour",d:"day",D:"date",w:"week",W:"isoWeek",M:"month",y:"year",DDD:"dayOfYear",e:"weekday",E:"isoWeekday",gg:"weekYear",GG:"isoWeekYear"},Ub={dayofyear:"dayOfYear",isoweekday:"isoWeekday",isoweek:"isoWeek",weekyear:"weekYear",isoweekyear:"isoWeekYear"},Vb={},Wb="DDD w W M D d".split(" "),Xb="M D H h m s w W".split(" "),Yb={M:function(){return this.month()+1},MMM:function(a){return this.lang().monthsShort(this,a)},MMMM:function(a){return this.lang().months(this,a)},D:function(){return this.date()},DDD:function(){return this.dayOfYear()},d:function(){return this.day()},dd:function(a){return this.lang().weekdaysMin(this,a)},ddd:function(a){return this.lang().weekdaysShort(this,a)},dddd:function(a){return this.lang().weekdays(this,a)},w:function(){return this.week()},W:function(){return this.isoWeek()},YY:function(){return k(this.year()%100,2)},YYYY:function(){return k(this.year(),4)},YYYYY:function(){return k(this.year(),5)},YYYYYY:function(){var a=this.year(),b=a>=0?"+":"-";return b+k(Math.abs(a),6)},gg:function(){return k(this.weekYear()%100,2)},gggg:function(){return k(this.weekYear(),4)},ggggg:function(){return k(this.weekYear(),5)},GG:function(){return k(this.isoWeekYear()%100,2)},GGGG:function(){return k(this.isoWeekYear(),4)},GGGGG:function(){return k(this.isoWeekYear(),5)},e:function(){return this.weekday()},E:function(){return this.isoWeekday()},a:function(){return this.lang().meridiem(this.hours(),this.minutes(),!0)},A:function(){return this.lang().meridiem(this.hours(),this.minutes(),!1)},H:function(){return this.hours()},h:function(){return this.hours()%12||12},m:function(){return this.minutes()},s:function(){return this.seconds()},S:function(){return s(this.milliseconds()/100)},SS:function(){return k(s(this.milliseconds()/10),2)},SSS:function(){return k(this.milliseconds(),3)},SSSS:function(){return k(this.milliseconds(),3)},Z:function(){var a=-this.zone(),b="+";return 0>a&&(a=-a,b="-"),b+k(s(a/60),2)+":"+k(s(a)%60,2)},ZZ:function(){var a=-this.zone(),b="+";return 0>a&&(a=-a,b="-"),b+k(s(a/60),2)+k(s(a)%60,2)},z:function(){return this.zoneAbbr()},zz:function(){return this.zoneName()},X:function(){return this.unix()},Q:function(){return this.quarter()}},Zb=["months","monthsShort","weekdays","weekdaysShort","weekdaysMin"];Wb.length;)eb=Wb.pop(),Yb[eb+"o"]=d(Yb[eb],eb);for(;Xb.length;)eb=Xb.pop(),Yb[eb+eb]=c(Yb[eb],2);for(Yb.DDDD=c(Yb.DDD,3),h(e.prototype,{set:function(a){var b,c;for(c in a)b=a[c],"function"==typeof b?this[c]=b:this["_"+c]=b},_months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),months:function(a){return this._months[a.month()]},_monthsShort:"Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),monthsShort:function(a){return this._monthsShort[a.month()]},monthsParse:function(a){var b,c,d;for(this._monthsParse||(this._monthsParse=[]),b=0;12>b;b++)if(this._monthsParse[b]||(c=db.utc([2e3,b]),d="^"+this.months(c,"")+"|^"+this.monthsShort(c,""),this._monthsParse[b]=new RegExp(d.replace(".",""),"i")),this._monthsParse[b].test(a))return b},_weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),weekdays:function(a){return this._weekdays[a.day()]},_weekdaysShort:"Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),weekdaysShort:function(a){return this._weekdaysShort[a.day()]},_weekdaysMin:"Su_Mo_Tu_We_Th_Fr_Sa".split("_"),weekdaysMin:function(a){return this._weekdaysMin[a.day()]},weekdaysParse:function(a){var b,c,d;for(this._weekdaysParse||(this._weekdaysParse=[]),b=0;7>b;b++)if(this._weekdaysParse[b]||(c=db([2e3,1]).day(b),d="^"+this.weekdays(c,"")+"|^"+this.weekdaysShort(c,"")+"|^"+this.weekdaysMin(c,""),this._weekdaysParse[b]=new RegExp(d.replace(".",""),"i")),this._weekdaysParse[b].test(a))return b},_longDateFormat:{LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D YYYY",LLL:"MMMM D YYYY LT",LLLL:"dddd, MMMM D YYYY LT"},longDateFormat:function(a){var b=this._longDateFormat[a];return!b&&this._longDateFormat[a.toUpperCase()]&&(b=this._longDateFormat[a.toUpperCase()].replace(/MMMM|MM|DD|dddd/g,function(a){return a.slice(1)}),this._longDateFormat[a]=b),b},isPM:function(a){return"p"===(a+"").toLowerCase().charAt(0)},_meridiemParse:/[ap]\.?m?\.?/i,meridiem:function(a,b,c){return a>11?c?"pm":"PM":c?"am":"AM"},_calendar:{sameDay:"[Today at] LT",nextDay:"[Tomorrow at] LT",nextWeek:"dddd [at] LT",lastDay:"[Yesterday at] LT",lastWeek:"[Last] dddd [at] LT",sameElse:"L"},calendar:function(a,b){var c=this._calendar[a];return"function"==typeof c?c.apply(b):c},_relativeTime:{future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"},relativeTime:function(a,b,c,d){var e=this._relativeTime[c];return"function"==typeof e?e(a,b,c,d):e.replace(/%d/i,a)},pastFuture:function(a,b){var c=this._relativeTime[a>0?"future":"past"];return"function"==typeof c?c(b):c.replace(/%s/i,b)},ordinal:function(a){return this._ordinal.replace("%d",a)},_ordinal:"%d",preparse:function(a){return a},postformat:function(a){return a},week:function(a){return Y(a,this._week.dow,this._week.doy).week},_week:{dow:0,doy:6},_invalidDate:"Invalid date",invalidDate:function(){return this._invalidDate}}),db=function(c,d,e,f){var g;return"boolean"==typeof e&&(f=e,e=a),g={},g._isAMomentObject=!0,g._i=c,g._f=d,g._l=e,g._strict=f,g._isUTC=!1,g._pf=b(),$(g)},db.utc=function(c,d,e,f){var g;return"boolean"==typeof e&&(f=e,e=a),g={},g._isAMomentObject=!0,g._useUTC=!0,g._isUTC=!0,g._l=e,g._i=c,g._f=d,g._strict=f,g._pf=b(),$(g).utc()},db.unix=function(a){return db(1e3*a)},db.duration=function(a,b){var c,d,e,f=a,h=null;return db.isDuration(a)?f={ms:a._milliseconds,d:a._days,M:a._months}:"number"==typeof a?(f={},b?f[b]=a:f.milliseconds=a):(h=tb.exec(a))?(c="-"===h[1]?-1:1,f={y:0,d:s(h[kb])*c,h:s(h[lb])*c,m:s(h[mb])*c,s:s(h[nb])*c,ms:s(h[ob])*c}):(h=ub.exec(a))&&(c="-"===h[1]?-1:1,e=function(a){var b=a&&parseFloat(a.replace(",","."));return(isNaN(b)?0:b)*c},f={y:e(h[2]),M:e(h[3]),d:e(h[4]),h:e(h[5]),m:e(h[6]),s:e(h[7]),w:e(h[8])}),d=new g(f),db.isDuration(a)&&a.hasOwnProperty("_lang")&&(d._lang=a._lang),d},db.version=fb,db.defaultFormat=Nb,db.updateOffset=function(){},db.lang=function(a,b){var c;return a?(b?A(y(a),b):null===b?(B(a),a="en"):pb[a]||C(a),c=db.duration.fn._lang=db.fn._lang=C(a),c._abbr):db.fn._lang._abbr},db.langData=function(a){return a&&a._lang&&a._lang._abbr&&(a=a._lang._abbr),C(a)},db.isMoment=function(a){return a instanceof f||null!=a&&a.hasOwnProperty("_isAMomentObject")},db.isDuration=function(a){return a instanceof g},eb=Zb.length-1;eb>=0;--eb)r(Zb[eb]);for(db.normalizeUnits=function(a){return p(a)},db.invalid=function(a){var b=db.utc(0/0);return null!=a?h(b._pf,a):b._pf.userInvalidated=!0,b},db.parseZone=function(a){return db(a).parseZone()},h(db.fn=f.prototype,{clone:function(){return db(this)},valueOf:function(){return+this._d+6e4*(this._offset||0)},unix:function(){return Math.floor(+this/1e3)},toString:function(){return this.clone().lang("en").format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ")},toDate:function(){return this._offset?new Date(+this):this._d},toISOString:function(){var a=db(this).utc();return 0<a.year()&&a.year()<=9999?F(a,"YYYY-MM-DD[T]HH:mm:ss.SSS[Z]"):F(a,"YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]")},toArray:function(){var a=this;return[a.year(),a.month(),a.date(),a.hours(),a.minutes(),a.seconds(),a.milliseconds()]},isValid:function(){return x(this)},isDSTShifted:function(){return this._a?this.isValid()&&o(this._a,(this._isUTC?db.utc(this._a):db(this._a)).toArray())>0:!1},parsingFlags:function(){return h({},this._pf)},invalidAt:function(){return this._pf.overflow},utc:function(){return this.zone(0)},local:function(){return this.zone(0),this._isUTC=!1,this},format:function(a){var b=F(this,a||db.defaultFormat);return this.lang().postformat(b)},add:function(a,b){var c;return c="string"==typeof a?db.duration(+b,a):db.duration(a,b),l(this,c,1),this},subtract:function(a,b){var c;return c="string"==typeof a?db.duration(+b,a):db.duration(a,b),l(this,c,-1),this},diff:function(a,b,c){var d,e,f=z(a,this),g=6e4*(this.zone()-f.zone());return b=p(b),"year"===b||"month"===b?(d=432e5*(this.daysInMonth()+f.daysInMonth()),e=12*(this.year()-f.year())+(this.month()-f.month()),e+=(this-db(this).startOf("month")-(f-db(f).startOf("month")))/d,e-=6e4*(this.zone()-db(this).startOf("month").zone()-(f.zone()-db(f).startOf("month").zone()))/d,"year"===b&&(e/=12)):(d=this-f,e="second"===b?d/1e3:"minute"===b?d/6e4:"hour"===b?d/36e5:"day"===b?(d-g)/864e5:"week"===b?(d-g)/6048e5:d),c?e:j(e)},from:function(a,b){return db.duration(this.diff(a)).lang(this.lang()._abbr).humanize(!b)},fromNow:function(a){return this.from(db(),a)},calendar:function(){var a=z(db(),this).startOf("day"),b=this.diff(a,"days",!0),c=-6>b?"sameElse":-1>b?"lastWeek":0>b?"lastDay":1>b?"sameDay":2>b?"nextDay":7>b?"nextWeek":"sameElse";return this.format(this.lang().calendar(c,this))},isLeapYear:function(){return v(this.year())},isDST:function(){return this.zone()<this.clone().month(0).zone()||this.zone()<this.clone().month(5).zone()},day:function(a){var b=this._isUTC?this._d.getUTCDay():this._d.getDay();return null!=a?(a=V(a,this.lang()),this.add({d:a-b})):b},month:function(a){var b,c=this._isUTC?"UTC":"";return null!=a?"string"==typeof a&&(a=this.lang().monthsParse(a),"number"!=typeof a)?this:(b=this.date(),this.date(1),this._d["set"+c+"Month"](a),this.date(Math.min(b,this.daysInMonth())),db.updateOffset(this),this):this._d["get"+c+"Month"]()},startOf:function(a){switch(a=p(a)){case"year":this.month(0);case"month":this.date(1);case"week":case"isoWeek":case"day":this.hours(0);case"hour":this.minutes(0);case"minute":this.seconds(0);case"second":this.milliseconds(0)}return"week"===a?this.weekday(0):"isoWeek"===a&&this.isoWeekday(1),this},endOf:function(a){return a=p(a),this.startOf(a).add("isoWeek"===a?"week":a,1).subtract("ms",1)},isAfter:function(a,b){return b="undefined"!=typeof b?b:"millisecond",+this.clone().startOf(b)>+db(a).startOf(b)},isBefore:function(a,b){return b="undefined"!=typeof b?b:"millisecond",+this.clone().startOf(b)<+db(a).startOf(b)},isSame:function(a,b){return b=b||"ms",+this.clone().startOf(b)===+z(a,this).startOf(b)},min:function(a){return a=db.apply(null,arguments),this>a?this:a},max:function(a){return a=db.apply(null,arguments),a>this?this:a},zone:function(a){var b=this._offset||0;return null==a?this._isUTC?b:this._d.getTimezoneOffset():("string"==typeof a&&(a=I(a)),Math.abs(a)<16&&(a=60*a),this._offset=a,this._isUTC=!0,b!==a&&l(this,db.duration(b-a,"m"),1,!0),this)},zoneAbbr:function(){return this._isUTC?"UTC":""},zoneName:function(){return this._isUTC?"Coordinated Universal Time":""},parseZone:function(){return this._tzm?this.zone(this._tzm):"string"==typeof this._i&&this.zone(this._i),this},hasAlignedHourOffset:function(a){return a=a?db(a).zone():0,(this.zone()-a)%60===0},daysInMonth:function(){return t(this.year(),this.month())},dayOfYear:function(a){var b=hb((db(this).startOf("day")-db(this).startOf("year"))/864e5)+1;return null==a?b:this.add("d",a-b)},quarter:function(){return Math.ceil((this.month()+1)/3)},weekYear:function(a){var b=Y(this,this.lang()._week.dow,this.lang()._week.doy).year;return null==a?b:this.add("y",a-b)},isoWeekYear:function(a){var b=Y(this,1,4).year;return null==a?b:this.add("y",a-b)},week:function(a){var b=this.lang().week(this);return null==a?b:this.add("d",7*(a-b))},isoWeek:function(a){var b=Y(this,1,4).week;return null==a?b:this.add("d",7*(a-b))},weekday:function(a){var b=(this.day()+7-this.lang()._week.dow)%7;return null==a?b:this.add("d",a-b)},isoWeekday:function(a){return null==a?this.day()||7:this.day(this.day()%7?a:a-7)},get:function(a){return a=p(a),this[a]()},set:function(a,b){return a=p(a),"function"==typeof this[a]&&this[a](b),this},lang:function(b){return b===a?this._lang:(this._lang=C(b),this)}}),eb=0;eb<Rb.length;eb++)_(Rb[eb].toLowerCase().replace(/s$/,""),Rb[eb]);_("year","FullYear"),db.fn.days=db.fn.day,db.fn.months=db.fn.month,db.fn.weeks=db.fn.week,db.fn.isoWeeks=db.fn.isoWeek,db.fn.toJSON=db.fn.toISOString,h(db.duration.fn=g.prototype,{_bubble:function(){var a,b,c,d,e=this._milliseconds,f=this._days,g=this._months,h=this._data;h.milliseconds=e%1e3,a=j(e/1e3),h.seconds=a%60,b=j(a/60),h.minutes=b%60,c=j(b/60),h.hours=c%24,f+=j(c/24),h.days=f%30,g+=j(f/30),h.months=g%12,d=j(g/12),h.years=d},weeks:function(){return j(this.days()/7)},valueOf:function(){return this._milliseconds+864e5*this._days+this._months%12*2592e6+31536e6*s(this._months/12)},humanize:function(a){var b=+this,c=X(b,!a,this.lang());return a&&(c=this.lang().pastFuture(b,c)),this.lang().postformat(c)},add:function(a,b){var c=db.duration(a,b);return this._milliseconds+=c._milliseconds,this._days+=c._days,this._months+=c._months,this._bubble(),this},subtract:function(a,b){var c=db.duration(a,b);return this._milliseconds-=c._milliseconds,this._days-=c._days,this._months-=c._months,this._bubble(),this},get:function(a){return a=p(a),this[a.toLowerCase()+"s"]()},as:function(a){return a=p(a),this["as"+a.charAt(0).toUpperCase()+a.slice(1)+"s"]()},lang:db.fn.lang,toIsoString:function(){var a=Math.abs(this.years()),b=Math.abs(this.months()),c=Math.abs(this.days()),d=Math.abs(this.hours()),e=Math.abs(this.minutes()),f=Math.abs(this.seconds()+this.milliseconds()/1e3);return this.asSeconds()?(this.asSeconds()<0?"-":"")+"P"+(a?a+"Y":"")+(b?b+"M":"")+(c?c+"D":"")+(d||e||f?"T":"")+(d?d+"H":"")+(e?e+"M":"")+(f?f+"S":""):"P0D"}});for(eb in Sb)Sb.hasOwnProperty(eb)&&(bb(eb,Sb[eb]),ab(eb.toLowerCase()));bb("Weeks",6048e5),db.duration.fn.asMonths=function(){return(+this-31536e6*this.years())/2592e6+12*this.years()},db.lang("en",{ordinal:function(a){var b=a%10,c=1===s(a%100/10)?"th":1===b?"st":2===b?"nd":3===b?"rd":"th";return a+c}}),rb?(module.exports=db,cb(!0)):"function"==typeof define&&define.amd?define("moment",['require','exports','module'],function(b,c,d){return d.config&&d.config()&&d.config().noGlobal!==!0&&cb(d.config().noGlobal===a),db}):cb()}).call(this);
/*
 Highcharts JS v3.0.7 (2013-10-24)

 (c) 2009-2013 Torstein Hønsi

 License: www.highcharts.com/license
*/
(function(){function s(a,b){var c;a||(a={});for(c in b)a[c]=b[c];return a}function x(){var a,b=arguments.length,c={},d=function(a,b){var c,h;typeof a!=="object"&&(a={});for(h in b)b.hasOwnProperty(h)&&(c=b[h],a[h]=c&&typeof c==="object"&&Object.prototype.toString.call(c)!=="[object Array]"&&typeof c.nodeType!=="number"?d(a[h]||{},c):b[h]);return a};for(a=0;a<b;a++)c=d(c,arguments[a]);return c}function y(a,b){return parseInt(a,b||10)}function ea(a){return typeof a==="string"}function T(a){return typeof a===
"object"}function Ia(a){return Object.prototype.toString.call(a)==="[object Array]"}function ra(a){return typeof a==="number"}function ma(a){return R.log(a)/R.LN10}function fa(a){return R.pow(10,a)}function ga(a,b){for(var c=a.length;c--;)if(a[c]===b){a.splice(c,1);break}}function u(a){return a!==v&&a!==null}function w(a,b,c){var d,e;if(ea(b))u(c)?a.setAttribute(b,c):a&&a.getAttribute&&(e=a.getAttribute(b));else if(u(b)&&T(b))for(d in b)a.setAttribute(d,b[d]);return e}function ja(a){return Ia(a)?
a:[a]}function o(){var a=arguments,b,c,d=a.length;for(b=0;b<d;b++)if(c=a[b],typeof c!=="undefined"&&c!==null)return c}function I(a,b){if(sa&&b&&b.opacity!==v)b.filter="alpha(opacity="+b.opacity*100+")";s(a.style,b)}function U(a,b,c,d,e){a=z.createElement(a);b&&s(a,b);e&&I(a,{padding:0,border:S,margin:0});c&&I(a,c);d&&d.appendChild(a);return a}function ha(a,b){var c=function(){};c.prototype=new a;s(c.prototype,b);return c}function Aa(a,b,c,d){var e=L.lang,a=+a||0,f=b===-1?(a.toString().split(".")[1]||
"").length:isNaN(b=M(b))?2:b,b=c===void 0?e.decimalPoint:c,d=d===void 0?e.thousandsSep:d,e=a<0?"-":"",c=String(y(a=M(a).toFixed(f))),g=c.length>3?c.length%3:0;return e+(g?c.substr(0,g)+d:"")+c.substr(g).replace(/(\d{3})(?=\d)/g,"$1"+d)+(f?b+M(a-c).toFixed(f).slice(2):"")}function Ba(a,b){return Array((b||2)+1-String(a).length).join(0)+a}function mb(a,b,c){var d=a[b];a[b]=function(){var a=Array.prototype.slice.call(arguments);a.unshift(d);return c.apply(this,a)}}function Ca(a,b){for(var c="{",d=!1,
e,f,g,h,i,j=[];(c=a.indexOf(c))!==-1;){e=a.slice(0,c);if(d){f=e.split(":");g=f.shift().split(".");i=g.length;e=b;for(h=0;h<i;h++)e=e[g[h]];if(f.length)f=f.join(":"),g=/\.([0-9])/,h=L.lang,i=void 0,/f$/.test(f)?(i=(i=f.match(g))?i[1]:-1,e=Aa(e,i,h.decimalPoint,f.indexOf(",")>-1?h.thousandsSep:"")):e=Ya(f,e)}j.push(e);a=a.slice(c+1);c=(d=!d)?"}":"{"}j.push(a);return j.join("")}function nb(a){return R.pow(10,P(R.log(a)/R.LN10))}function ob(a,b,c,d){var e,c=o(c,1);e=a/c;b||(b=[1,2,2.5,5,10],d&&d.allowDecimals===
!1&&(c===1?b=[1,2,5,10]:c<=0.1&&(b=[1/c])));for(d=0;d<b.length;d++)if(a=b[d],e<=(b[d]+(b[d+1]||b[d]))/2)break;a*=c;return a}function Cb(a,b){var c=b||[[Db,[1,2,5,10,20,25,50,100,200,500]],[pb,[1,2,5,10,15,30]],[Za,[1,2,5,10,15,30]],[Qa,[1,2,3,4,6,8,12]],[ta,[1,2]],[$a,[1,2]],[Ra,[1,2,3,4,6]],[Da,null]],d=c[c.length-1],e=D[d[0]],f=d[1],g;for(g=0;g<c.length;g++)if(d=c[g],e=D[d[0]],f=d[1],c[g+1]&&a<=(e*f[f.length-1]+D[c[g+1][0]])/2)break;e===D[Da]&&a<5*e&&(f=[1,2,5]);c=ob(a/e,f,d[0]===Da?r(nb(a/e),1):
1);return{unitRange:e,count:c,unitName:d[0]}}function Eb(a,b,c,d){var e=[],f={},g=L.global.useUTC,h,i=new Date(b),j=a.unitRange,k=a.count;if(u(b)){j>=D[pb]&&(i.setMilliseconds(0),i.setSeconds(j>=D[Za]?0:k*P(i.getSeconds()/k)));if(j>=D[Za])i[Fb](j>=D[Qa]?0:k*P(i[qb]()/k));if(j>=D[Qa])i[Gb](j>=D[ta]?0:k*P(i[rb]()/k));if(j>=D[ta])i[sb](j>=D[Ra]?1:k*P(i[Sa]()/k));j>=D[Ra]&&(i[Hb](j>=D[Da]?0:k*P(i[ab]()/k)),h=i[bb]());j>=D[Da]&&(h-=h%k,i[Ib](h));if(j===D[$a])i[sb](i[Sa]()-i[tb]()+o(d,1));b=1;h=i[bb]();
for(var d=i.getTime(),l=i[ab](),m=i[Sa](),p=g?0:(864E5+i.getTimezoneOffset()*6E4)%864E5;d<c;)e.push(d),j===D[Da]?d=cb(h+b*k,0):j===D[Ra]?d=cb(h,l+b*k):!g&&(j===D[ta]||j===D[$a])?d=cb(h,l,m+b*k*(j===D[ta]?1:7)):d+=j*k,b++;e.push(d);n(ub(e,function(a){return j<=D[Qa]&&a%D[ta]===p}),function(a){f[a]=ta})}e.info=s(a,{higherRanks:f,totalRange:j*k});return e}function Jb(){this.symbol=this.color=0}function Kb(a,b){var c=a.length,d,e;for(e=0;e<c;e++)a[e].ss_i=e;a.sort(function(a,c){d=b(a,c);return d===0?
a.ss_i-c.ss_i:d});for(e=0;e<c;e++)delete a[e].ss_i}function Ja(a){for(var b=a.length,c=a[0];b--;)a[b]<c&&(c=a[b]);return c}function ua(a){for(var b=a.length,c=a[0];b--;)a[b]>c&&(c=a[b]);return c}function Ka(a,b){for(var c in a)a[c]&&a[c]!==b&&a[c].destroy&&a[c].destroy(),delete a[c]}function Ta(a){db||(db=U(Ea));a&&db.appendChild(a);db.innerHTML=""}function ka(a,b){var c="Highcharts error #"+a+": www.highcharts.com/errors/"+a;if(b)throw c;else N.console&&console.log(c)}function ia(a){return parseFloat(a.toPrecision(14))}
function La(a,b){Fa=o(a,b.animation)}function Lb(){var a=L.global.useUTC,b=a?"getUTC":"get",c=a?"setUTC":"set";cb=a?Date.UTC:function(a,b,c,g,h,i){return(new Date(a,b,o(c,1),o(g,0),o(h,0),o(i,0))).getTime()};qb=b+"Minutes";rb=b+"Hours";tb=b+"Day";Sa=b+"Date";ab=b+"Month";bb=b+"FullYear";Fb=c+"Minutes";Gb=c+"Hours";sb=c+"Date";Hb=c+"Month";Ib=c+"FullYear"}function va(){}function Ma(a,b,c,d){this.axis=a;this.pos=b;this.type=c||"";this.isNew=!0;!c&&!d&&this.addLabel()}function vb(a,b){this.axis=a;if(b)this.options=
b,this.id=b.id}function Mb(a,b,c,d,e,f){var g=a.chart.inverted;this.axis=a;this.isNegative=c;this.options=b;this.x=d;this.total=null;this.points={};this.stack=e;this.percent=f==="percent";this.alignOptions={align:b.align||(g?c?"left":"right":"center"),verticalAlign:b.verticalAlign||(g?"middle":c?"bottom":"top"),y:o(b.y,g?4:c?14:-6),x:o(b.x,g?c?-6:6:0)};this.textAlign=b.textAlign||(g?c?"right":"left":"center")}function eb(){this.init.apply(this,arguments)}function wb(){this.init.apply(this,arguments)}
function xb(a,b){this.init(a,b)}function fb(a,b){this.init(a,b)}function yb(){this.init.apply(this,arguments)}var v,z=document,N=window,R=Math,t=R.round,P=R.floor,wa=R.ceil,r=R.max,J=R.min,M=R.abs,V=R.cos,ba=R.sin,xa=R.PI,Ua=xa*2/360,na=navigator.userAgent,Nb=N.opera,sa=/msie/i.test(na)&&!Nb,gb=z.documentMode===8,hb=/AppleWebKit/.test(na),ib=/Firefox/.test(na),Ob=/(Mobile|Android|Windows Phone)/.test(na),ya="http://www.w3.org/2000/svg",W=!!z.createElementNS&&!!z.createElementNS(ya,"svg").createSVGRect,
Ub=ib&&parseInt(na.split("Firefox/")[1],10)<4,ca=!W&&!sa&&!!z.createElement("canvas").getContext,Va,jb=z.documentElement.ontouchstart!==v,Pb={},zb=0,db,L,Ya,Fa,Ab,D,oa=function(){},Ga=[],Ea="div",S="none",Qb="rgba(192,192,192,"+(W?1.0E-4:0.002)+")",Db="millisecond",pb="second",Za="minute",Qa="hour",ta="day",$a="week",Ra="month",Da="year",Rb="stroke-width",cb,qb,rb,tb,Sa,ab,bb,Fb,Gb,sb,Hb,Ib,X={};N.Highcharts=N.Highcharts?ka(16,!0):{};Ya=function(a,b,c){if(!u(b)||isNaN(b))return"Invalid date";var a=
o(a,"%Y-%m-%d %H:%M:%S"),d=new Date(b),e,f=d[rb](),g=d[tb](),h=d[Sa](),i=d[ab](),j=d[bb](),k=L.lang,l=k.weekdays,d=s({a:l[g].substr(0,3),A:l[g],d:Ba(h),e:h,b:k.shortMonths[i],B:k.months[i],m:Ba(i+1),y:j.toString().substr(2,2),Y:j,H:Ba(f),I:Ba(f%12||12),l:f%12||12,M:Ba(d[qb]()),p:f<12?"AM":"PM",P:f<12?"am":"pm",S:Ba(d.getSeconds()),L:Ba(t(b%1E3),3)},Highcharts.dateFormats);for(e in d)for(;a.indexOf("%"+e)!==-1;)a=a.replace("%"+e,typeof d[e]==="function"?d[e](b):d[e]);return c?a.substr(0,1).toUpperCase()+
a.substr(1):a};Jb.prototype={wrapColor:function(a){if(this.color>=a)this.color=0},wrapSymbol:function(a){if(this.symbol>=a)this.symbol=0}};D=function(){for(var a=0,b=arguments,c=b.length,d={};a<c;a++)d[b[a++]]=b[a];return d}(Db,1,pb,1E3,Za,6E4,Qa,36E5,ta,864E5,$a,6048E5,Ra,26784E5,Da,31556952E3);Ab={init:function(a,b,c){var b=b||"",d=a.shift,e=b.indexOf("C")>-1,f=e?7:3,g,b=b.split(" "),c=[].concat(c),h,i,j=function(a){for(g=a.length;g--;)a[g]==="M"&&a.splice(g+1,0,a[g+1],a[g+2],a[g+1],a[g+2])};e&&
(j(b),j(c));a.isArea&&(h=b.splice(b.length-6,6),i=c.splice(c.length-6,6));if(d<=c.length/f&&b.length===c.length)for(;d--;)c=[].concat(c).splice(0,f).concat(c);a.shift=0;if(b.length)for(a=c.length;b.length<a;)d=[].concat(b).splice(b.length-f,f),e&&(d[f-6]=d[f-2],d[f-5]=d[f-1]),b=b.concat(d);h&&(b=b.concat(h),c=c.concat(i));return[b,c]},step:function(a,b,c,d){var e=[],f=a.length;if(c===1)e=d;else if(f===b.length&&c<1)for(;f--;)d=parseFloat(a[f]),e[f]=isNaN(d)?a[f]:c*parseFloat(b[f]-d)+d;else e=b;return e}};
(function(a){N.HighchartsAdapter=N.HighchartsAdapter||a&&{init:function(b){var c=a.fx,d=c.step,e,f=a.Tween,g=f&&f.propHooks;e=a.cssHooks.opacity;a.extend(a.easing,{easeOutQuad:function(a,b,c,d,e){return-d*(b/=e)*(b-2)+c}});a.each(["cur","_default","width","height","opacity"],function(a,b){var e=d,k,l;b==="cur"?e=c.prototype:b==="_default"&&f&&(e=g[b],b="set");(k=e[b])&&(e[b]=function(c){c=a?c:this;if(c.prop!=="align")return l=c.elem,l.attr?l.attr(c.prop,b==="cur"?v:c.now):k.apply(this,arguments)})});
mb(e,"get",function(a,b,c){return b.attr?b.opacity||0:a.call(this,b,c)});e=function(a){var c=a.elem,d;if(!a.started)d=b.init(c,c.d,c.toD),a.start=d[0],a.end=d[1],a.started=!0;c.attr("d",b.step(a.start,a.end,a.pos,c.toD))};f?g.d={set:e}:d.d=e;this.each=Array.prototype.forEach?function(a,b){return Array.prototype.forEach.call(a,b)}:function(a,b){for(var c=0,d=a.length;c<d;c++)if(b.call(a[c],a[c],c,a)===!1)return c};a.fn.highcharts=function(){var a="Chart",b=arguments,c,d;ea(b[0])&&(a=b[0],b=Array.prototype.slice.call(b,
1));c=b[0];if(c!==v)c.chart=c.chart||{},c.chart.renderTo=this[0],new Highcharts[a](c,b[1]),d=this;c===v&&(d=Ga[w(this[0],"data-highcharts-chart")]);return d}},getScript:a.getScript,inArray:a.inArray,adapterRun:function(b,c){return a(b)[c]()},grep:a.grep,map:function(a,c){for(var d=[],e=0,f=a.length;e<f;e++)d[e]=c.call(a[e],a[e],e,a);return d},offset:function(b){return a(b).offset()},addEvent:function(b,c,d){a(b).bind(c,d)},removeEvent:function(b,c,d){var e=z.removeEventListener?"removeEventListener":
"detachEvent";z[e]&&b&&!b[e]&&(b[e]=function(){});a(b).unbind(c,d)},fireEvent:function(b,c,d,e){var f=a.Event(c),g="detached"+c,h;!sa&&d&&(delete d.layerX,delete d.layerY);s(f,d);b[c]&&(b[g]=b[c],b[c]=null);a.each(["preventDefault","stopPropagation"],function(a,b){var c=f[b];f[b]=function(){try{c.call(f)}catch(a){b==="preventDefault"&&(h=!0)}}});a(b).trigger(f);b[g]&&(b[c]=b[g],b[g]=null);e&&!f.isDefaultPrevented()&&!h&&e(f)},washMouseEvent:function(a){var c=a.originalEvent||a;if(c.pageX===v)c.pageX=
a.pageX,c.pageY=a.pageY;return c},animate:function(b,c,d){var e=a(b);if(!b.style)b.style={};if(c.d)b.toD=c.d,c.d=1;e.stop();c.opacity!==v&&b.attr&&(c.opacity+="px");e.animate(c,d)},stop:function(b){a(b).stop()}}})(N.jQuery);var Y=N.HighchartsAdapter,G=Y||{};Y&&Y.init.call(Y,Ab);var kb=G.adapterRun,Vb=G.getScript,pa=G.inArray,n=G.each,ub=G.grep,Wb=G.offset,Na=G.map,K=G.addEvent,$=G.removeEvent,A=G.fireEvent,Xb=G.washMouseEvent,Bb=G.animate,Wa=G.stop,G={enabled:!0,x:0,y:15,style:{color:"#666",cursor:"default",
fontSize:"11px",lineHeight:"14px"}};L={colors:"#2f7ed8,#0d233a,#8bbc21,#910000,#1aadce,#492970,#f28f43,#77a1e5,#c42525,#a6c96a".split(","),symbols:["circle","diamond","square","triangle","triangle-down"],lang:{loading:"Loading...",months:"January,February,March,April,May,June,July,August,September,October,November,December".split(","),shortMonths:"Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec".split(","),weekdays:"Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday".split(","),decimalPoint:".",
numericSymbols:"k,M,G,T,P,E".split(","),resetZoom:"Reset zoom",resetZoomTitle:"Reset zoom level 1:1",thousandsSep:","},global:{useUTC:!0,canvasToolsURL:"http://code.highcharts.com/3.0.7/modules/canvas-tools.js",VMLRadialGradientURL:"http://code.highcharts.com/3.0.7/gfx/vml-radial-gradient.png"},chart:{borderColor:"#4572A7",borderRadius:5,defaultSeriesType:"line",ignoreHiddenSeries:!0,spacing:[10,10,15,10],style:{fontFamily:'"Lucida Grande", "Lucida Sans Unicode", Verdana, Arial, Helvetica, sans-serif',
fontSize:"12px"},backgroundColor:"#FFFFFF",plotBorderColor:"#C0C0C0",resetZoomButton:{theme:{zIndex:20},position:{align:"right",x:-10,y:10}}},title:{text:"Chart title",align:"center",margin:15,style:{color:"#274b6d",fontSize:"16px"}},subtitle:{text:"",align:"center",style:{color:"#4d759e"}},plotOptions:{line:{allowPointSelect:!1,showCheckbox:!1,animation:{duration:1E3},events:{},lineWidth:2,marker:{enabled:!0,lineWidth:0,radius:4,lineColor:"#FFFFFF",states:{hover:{enabled:!0},select:{fillColor:"#FFFFFF",
lineColor:"#000000",lineWidth:2}}},point:{events:{}},dataLabels:x(G,{align:"center",enabled:!1,formatter:function(){return this.y===null?"":Aa(this.y,-1)},verticalAlign:"bottom",y:0}),cropThreshold:300,pointRange:0,states:{hover:{marker:{}},select:{marker:{}}},stickyTracking:!0}},labels:{style:{position:"absolute",color:"#3E576F"}},legend:{enabled:!0,align:"center",layout:"horizontal",labelFormatter:function(){return this.name},borderWidth:1,borderColor:"#909090",borderRadius:5,navigation:{activeColor:"#274b6d",
inactiveColor:"#CCC"},shadow:!1,itemStyle:{cursor:"pointer",color:"#274b6d",fontSize:"12px"},itemHoverStyle:{color:"#000"},itemHiddenStyle:{color:"#CCC"},itemCheckboxStyle:{position:"absolute",width:"13px",height:"13px"},symbolWidth:16,symbolPadding:5,verticalAlign:"bottom",x:0,y:0,title:{style:{fontWeight:"bold"}}},loading:{labelStyle:{fontWeight:"bold",position:"relative",top:"1em"},style:{position:"absolute",backgroundColor:"white",opacity:0.5,textAlign:"center"}},tooltip:{enabled:!0,animation:W,
backgroundColor:"rgba(255, 255, 255, .85)",borderWidth:1,borderRadius:3,dateTimeLabelFormats:{millisecond:"%A, %b %e, %H:%M:%S.%L",second:"%A, %b %e, %H:%M:%S",minute:"%A, %b %e, %H:%M",hour:"%A, %b %e, %H:%M",day:"%A, %b %e, %Y",week:"Week from %A, %b %e, %Y",month:"%B %Y",year:"%Y"},headerFormat:'<span style="font-size: 10px">{point.key}</span><br/>',pointFormat:'<span style="color:{series.color}">{series.name}</span>: <b>{point.y}</b><br/>',shadow:!0,snap:Ob?25:10,style:{color:"#333333",cursor:"default",
fontSize:"12px",padding:"8px",whiteSpace:"nowrap"}},credits:{enabled:!0,text:"Highcharts.com",href:"http://www.highcharts.com",position:{align:"right",x:-10,verticalAlign:"bottom",y:-5},style:{cursor:"pointer",color:"#909090",fontSize:"9px"}}};var Z=L.plotOptions,Y=Z.line;Lb();var Yb=/rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]?(?:\.[0-9]+)?)\s*\)/,Zb=/#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/,$b=/rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/,
qa=function(a){var b=[],c,d;(function(a){a&&a.stops?d=Na(a.stops,function(a){return qa(a[1])}):(c=Yb.exec(a))?b=[y(c[1]),y(c[2]),y(c[3]),parseFloat(c[4],10)]:(c=Zb.exec(a))?b=[y(c[1],16),y(c[2],16),y(c[3],16),1]:(c=$b.exec(a))&&(b=[y(c[1]),y(c[2]),y(c[3]),1])})(a);return{get:function(c){var f;d?(f=x(a),f.stops=[].concat(f.stops),n(d,function(a,b){f.stops[b]=[f.stops[b][0],a.get(c)]})):f=b&&!isNaN(b[0])?c==="rgb"?"rgb("+b[0]+","+b[1]+","+b[2]+")":c==="a"?b[3]:"rgba("+b.join(",")+")":a;return f},brighten:function(a){if(d)n(d,
function(b){b.brighten(a)});else if(ra(a)&&a!==0){var c;for(c=0;c<3;c++)b[c]+=y(a*255),b[c]<0&&(b[c]=0),b[c]>255&&(b[c]=255)}return this},rgba:b,setOpacity:function(a){b[3]=a;return this}}};va.prototype={init:function(a,b){this.element=b==="span"?U(b):z.createElementNS(ya,b);this.renderer=a;this.attrSetters={}},opacity:1,animate:function(a,b,c){b=o(b,Fa,!0);Wa(this);if(b){b=x(b);if(c)b.complete=c;Bb(this,a,b)}else this.attr(a),c&&c()},attr:function(a,b){var c,d,e,f,g=this.element,h=g.nodeName.toLowerCase(),
i=this.renderer,j,k=this.attrSetters,l=this.shadows,m,p,q=this;ea(a)&&u(b)&&(c=a,a={},a[c]=b);if(ea(a))c=a,h==="circle"?c={x:"cx",y:"cy"}[c]||c:c==="strokeWidth"&&(c="stroke-width"),q=w(g,c)||this[c]||0,c!=="d"&&c!=="visibility"&&c!=="fill"&&(q=parseFloat(q));else{for(c in a)if(j=!1,d=a[c],e=k[c]&&k[c].call(this,d,c),e!==!1){e!==v&&(d=e);if(c==="d")d&&d.join&&(d=d.join(" ")),/(NaN| {2}|^$)/.test(d)&&(d="M 0 0");else if(c==="x"&&h==="text")for(e=0;e<g.childNodes.length;e++)f=g.childNodes[e],w(f,"x")===
w(g,"x")&&w(f,"x",d);else if(this.rotation&&(c==="x"||c==="y"))p=!0;else if(c==="fill")d=i.color(d,g,c);else if(h==="circle"&&(c==="x"||c==="y"))c={x:"cx",y:"cy"}[c]||c;else if(h==="rect"&&c==="r")w(g,{rx:d,ry:d}),j=!0;else if(c==="translateX"||c==="translateY"||c==="rotation"||c==="verticalAlign"||c==="scaleX"||c==="scaleY")j=p=!0;else if(c==="stroke")d=i.color(d,g,c);else if(c==="dashstyle")if(c="stroke-dasharray",d=d&&d.toLowerCase(),d==="solid")d=S;else{if(d){d=d.replace("shortdashdotdot","3,1,1,1,1,1,").replace("shortdashdot",
"3,1,1,1").replace("shortdot","1,1,").replace("shortdash","3,1,").replace("longdash","8,3,").replace(/dot/g,"1,3,").replace("dash","4,3,").replace(/,$/,"").split(",");for(e=d.length;e--;)d[e]=y(d[e])*o(a["stroke-width"],this["stroke-width"]);d=d.join(",")}}else if(c==="width")d=y(d);else if(c==="align")c="text-anchor",d={left:"start",center:"middle",right:"end"}[d];else if(c==="title")e=g.getElementsByTagName("title")[0],e||(e=z.createElementNS(ya,"title"),g.appendChild(e)),e.textContent=d;c==="strokeWidth"&&
(c="stroke-width");if(c==="stroke-width"||c==="stroke"){this[c]=d;if(this.stroke&&this["stroke-width"])w(g,"stroke",this.stroke),w(g,"stroke-width",this["stroke-width"]),this.hasStroke=!0;else if(c==="stroke-width"&&d===0&&this.hasStroke)g.removeAttribute("stroke"),this.hasStroke=!1;j=!0}this.symbolName&&/^(x|y|width|height|r|start|end|innerR|anchorX|anchorY)/.test(c)&&(m||(this.symbolAttr(a),m=!0),j=!0);if(l&&/^(width|height|visibility|x|y|d|transform|cx|cy|r)$/.test(c))for(e=l.length;e--;)w(l[e],
c,c==="height"?r(d-(l[e].cutHeight||0),0):d);if((c==="width"||c==="height")&&h==="rect"&&d<0)d=0;this[c]=d;c==="text"?(d!==this.textStr&&delete this.bBox,this.textStr=d,this.added&&i.buildText(this)):j||w(g,c,d)}p&&this.updateTransform()}return q},addClass:function(a){var b=this.element,c=w(b,"class")||"";c.indexOf(a)===-1&&w(b,"class",c+" "+a);return this},symbolAttr:function(a){var b=this;n("x,y,r,start,end,width,height,innerR,anchorX,anchorY".split(","),function(c){b[c]=o(a[c],b[c])});b.attr({d:b.renderer.symbols[b.symbolName](b.x,
b.y,b.width,b.height,b)})},clip:function(a){return this.attr("clip-path",a?"url("+this.renderer.url+"#"+a.id+")":S)},crisp:function(a,b,c,d,e){var f,g={},h={},i,a=a||this.strokeWidth||this.attr&&this.attr("stroke-width")||0;i=t(a)%2/2;h.x=P(b||this.x||0)+i;h.y=P(c||this.y||0)+i;h.width=P((d||this.width||0)-2*i);h.height=P((e||this.height||0)-2*i);h.strokeWidth=a;for(f in h)this[f]!==h[f]&&(this[f]=g[f]=h[f]);return g},css:function(a){var b=this.element,c=this.textWidth=a&&a.width&&b.nodeName.toLowerCase()===
"text"&&y(a.width),d,e="",f=function(a,b){return"-"+b.toLowerCase()};if(a&&a.color)a.fill=a.color;this.styles=a=s(this.styles,a);c&&delete a.width;if(sa&&!W)I(this.element,a);else{for(d in a)e+=d.replace(/([A-Z])/g,f)+":"+a[d]+";";w(b,"style",e)}c&&this.added&&this.renderer.buildText(this);return this},on:function(a,b){var c=this,d=c.element;jb&&a==="click"?(d.ontouchstart=function(a){c.touchEventFired=Date.now();a.preventDefault();b.call(d,a)},d.onclick=function(a){(na.indexOf("Android")===-1||Date.now()-
(c.touchEventFired||0)>1100)&&b.call(d,a)}):d["on"+a]=b;return this},setRadialReference:function(a){this.element.radialReference=a;return this},translate:function(a,b){return this.attr({translateX:a,translateY:b})},invert:function(){this.inverted=!0;this.updateTransform();return this},htmlCss:function(a){var b=this.element;if(b=a&&b.tagName==="SPAN"&&a.width)delete a.width,this.textWidth=b,this.updateTransform();this.styles=s(this.styles,a);I(this.element,a);return this},htmlGetBBox:function(){var a=
this.element,b=this.bBox;if(!b){if(a.nodeName==="text")a.style.position="absolute";b=this.bBox={x:a.offsetLeft,y:a.offsetTop,width:a.offsetWidth,height:a.offsetHeight}}return b},htmlUpdateTransform:function(){if(this.added){var a=this.renderer,b=this.element,c=this.translateX||0,d=this.translateY||0,e=this.x||0,f=this.y||0,g=this.textAlign||"left",h={left:0,center:0.5,right:1}[g],i=g&&g!=="left",j=this.shadows;I(b,{marginLeft:c,marginTop:d});j&&n(j,function(a){I(a,{marginLeft:c+1,marginTop:d+1})});
this.inverted&&n(b.childNodes,function(c){a.invertChild(c,b)});if(b.tagName==="SPAN"){var k,l,j=this.rotation,m;k=0;var p=1,q=0,aa;m=y(this.textWidth);var B=this.xCorr||0,O=this.yCorr||0,Sb=[j,g,b.innerHTML,this.textWidth].join(",");if(Sb!==this.cTT){u(j)&&(k=j*Ua,p=V(k),q=ba(k),this.setSpanRotation(j,q,p));k=o(this.elemWidth,b.offsetWidth);l=o(this.elemHeight,b.offsetHeight);if(k>m&&/[ \-]/.test(b.textContent||b.innerText))I(b,{width:m+"px",display:"block",whiteSpace:"normal"}),k=m;m=a.fontMetrics(b.style.fontSize).b;
B=p<0&&-k;O=q<0&&-l;aa=p*q<0;B+=q*m*(aa?1-h:h);O-=p*m*(j?aa?h:1-h:1);i&&(B-=k*h*(p<0?-1:1),j&&(O-=l*h*(q<0?-1:1)),I(b,{textAlign:g}));this.xCorr=B;this.yCorr=O}I(b,{left:e+B+"px",top:f+O+"px"});if(hb)l=b.offsetHeight;this.cTT=Sb}}else this.alignOnAdd=!0},setSpanRotation:function(a){var b={};b[sa?"-ms-transform":hb?"-webkit-transform":ib?"MozTransform":Nb?"-o-transform":""]=b.transform="rotate("+a+"deg)";I(this.element,b)},updateTransform:function(){var a=this.translateX||0,b=this.translateY||0,c=
this.scaleX,d=this.scaleY,e=this.inverted,f=this.rotation;e&&(a+=this.attr("width"),b+=this.attr("height"));a=["translate("+a+","+b+")"];e?a.push("rotate(90) scale(-1,1)"):f&&a.push("rotate("+f+" "+(this.x||0)+" "+(this.y||0)+")");(u(c)||u(d))&&a.push("scale("+o(c,1)+" "+o(d,1)+")");a.length&&w(this.element,"transform",a.join(" "))},toFront:function(){var a=this.element;a.parentNode.appendChild(a);return this},align:function(a,b,c){var d,e,f,g,h={};e=this.renderer;f=e.alignedObjects;if(a){if(this.alignOptions=
a,this.alignByTranslate=b,!c||ea(c))this.alignTo=d=c||"renderer",ga(f,this),f.push(this),c=null}else a=this.alignOptions,b=this.alignByTranslate,d=this.alignTo;c=o(c,e[d],e);d=a.align;e=a.verticalAlign;f=(c.x||0)+(a.x||0);g=(c.y||0)+(a.y||0);if(d==="right"||d==="center")f+=(c.width-(a.width||0))/{right:1,center:2}[d];h[b?"translateX":"x"]=t(f);if(e==="bottom"||e==="middle")g+=(c.height-(a.height||0))/({bottom:1,middle:2}[e]||1);h[b?"translateY":"y"]=t(g);this[this.placed?"animate":"attr"](h);this.placed=
!0;this.alignAttr=h;return this},getBBox:function(){var a=this.bBox,b=this.renderer,c,d=this.rotation;c=this.element;var e=this.styles,f=d*Ua;if(!a){if(c.namespaceURI===ya||b.forExport){try{a=c.getBBox?s({},c.getBBox()):{width:c.offsetWidth,height:c.offsetHeight}}catch(g){}if(!a||a.width<0)a={width:0,height:0}}else a=this.htmlGetBBox();if(b.isSVG){b=a.width;c=a.height;if(sa&&e&&e.fontSize==="11px"&&c.toPrecision(3)==="22.7")a.height=c=14;if(d)a.width=M(c*ba(f))+M(b*V(f)),a.height=M(c*V(f))+M(b*ba(f))}this.bBox=
a}return a},show:function(){return this.attr({visibility:"visible"})},hide:function(){return this.attr({visibility:"hidden"})},fadeOut:function(a){var b=this;b.animate({opacity:0},{duration:a||150,complete:function(){b.hide()}})},add:function(a){var b=this.renderer,c=a||b,d=c.element||b.box,e=d.childNodes,f=this.element,g=w(f,"zIndex"),h;if(a)this.parentGroup=a;this.parentInverted=a&&a.inverted;this.textStr!==void 0&&b.buildText(this);if(g)c.handleZ=!0,g=y(g);if(c.handleZ)for(c=0;c<e.length;c++)if(a=
e[c],b=w(a,"zIndex"),a!==f&&(y(b)>g||!u(g)&&u(b))){d.insertBefore(f,a);h=!0;break}h||d.appendChild(f);this.added=!0;A(this,"add");return this},safeRemoveChild:function(a){var b=a.parentNode;b&&b.removeChild(a)},destroy:function(){var a=this,b=a.element||{},c=a.shadows,d=a.renderer.isSVG&&b.nodeName==="SPAN"&&a.parentGroup,e,f;b.onclick=b.onmouseout=b.onmouseover=b.onmousemove=b.point=null;Wa(a);if(a.clipPath)a.clipPath=a.clipPath.destroy();if(a.stops){for(f=0;f<a.stops.length;f++)a.stops[f]=a.stops[f].destroy();
a.stops=null}a.safeRemoveChild(b);for(c&&n(c,function(b){a.safeRemoveChild(b)});d&&d.div.childNodes.length===0;)b=d.parentGroup,a.safeRemoveChild(d.div),delete d.div,d=b;a.alignTo&&ga(a.renderer.alignedObjects,a);for(e in a)delete a[e];return null},shadow:function(a,b,c){var d=[],e,f,g=this.element,h,i,j,k;if(a){i=o(a.width,3);j=(a.opacity||0.15)/i;k=this.parentInverted?"(-1,-1)":"("+o(a.offsetX,1)+", "+o(a.offsetY,1)+")";for(e=1;e<=i;e++){f=g.cloneNode(0);h=i*2+1-2*e;w(f,{isShadow:"true",stroke:a.color||
"black","stroke-opacity":j*e,"stroke-width":h,transform:"translate"+k,fill:S});if(c)w(f,"height",r(w(f,"height")-h,0)),f.cutHeight=h;b?b.element.appendChild(f):g.parentNode.insertBefore(f,g);d.push(f)}this.shadows=d}return this}};var za=function(){this.init.apply(this,arguments)};za.prototype={Element:va,init:function(a,b,c,d){var e=location,f,g;f=this.createElement("svg").attr({version:"1.1"});g=f.element;a.appendChild(g);a.innerHTML.indexOf("xmlns")===-1&&w(g,"xmlns",ya);this.isSVG=!0;this.box=
g;this.boxWrapper=f;this.alignedObjects=[];this.url=(ib||hb)&&z.getElementsByTagName("base").length?e.href.replace(/#.*?$/,"").replace(/([\('\)])/g,"\\$1").replace(/ /g,"%20"):"";this.createElement("desc").add().element.appendChild(z.createTextNode("Created with Highcharts 3.0.7"));this.defs=this.createElement("defs").add();this.forExport=d;this.gradients={};this.setSize(b,c,!1);var h;if(ib&&a.getBoundingClientRect)this.subPixelFix=b=function(){I(a,{left:0,top:0});h=a.getBoundingClientRect();I(a,
{left:wa(h.left)-h.left+"px",top:wa(h.top)-h.top+"px"})},b(),K(N,"resize",b)},isHidden:function(){return!this.boxWrapper.getBBox().width},destroy:function(){var a=this.defs;this.box=null;this.boxWrapper=this.boxWrapper.destroy();Ka(this.gradients||{});this.gradients=null;if(a)this.defs=a.destroy();this.subPixelFix&&$(N,"resize",this.subPixelFix);return this.alignedObjects=null},createElement:function(a){var b=new this.Element;b.init(this,a);return b},draw:function(){},buildText:function(a){for(var b=
a.element,c=this,d=c.forExport,e=o(a.textStr,"").toString().replace(/<(b|strong)>/g,'<span style="font-weight:bold">').replace(/<(i|em)>/g,'<span style="font-style:italic">').replace(/<a/g,"<span").replace(/<\/(b|strong|i|em|a)>/g,"</span>").split(/<br.*?>/g),f=b.childNodes,g=/style="([^"]+)"/,h=/href="(http[^"]+)"/,i=w(b,"x"),j=a.styles,k=a.textWidth,l=j&&j.lineHeight,m=f.length;m--;)b.removeChild(f[m]);k&&!a.added&&this.box.appendChild(b);e[e.length-1]===""&&e.pop();n(e,function(e,f){var m,o=0,
e=e.replace(/<span/g,"|||<span").replace(/<\/span>/g,"</span>|||");m=e.split("|||");n(m,function(e){if(e!==""||m.length===1){var p={},n=z.createElementNS(ya,"tspan"),r;g.test(e)&&(r=e.match(g)[1].replace(/(;| |^)color([ :])/,"$1fill$2"),w(n,"style",r));h.test(e)&&!d&&(w(n,"onclick",'location.href="'+e.match(h)[1]+'"'),I(n,{cursor:"pointer"}));e=(e.replace(/<(.|\n)*?>/g,"")||" ").replace(/&lt;/g,"<").replace(/&gt;/g,">");if(e!==" "&&(n.appendChild(z.createTextNode(e)),o?p.dx=0:p.x=i,w(n,p),!o&&f&&
(!W&&d&&I(n,{display:"block"}),w(n,"dy",l||c.fontMetrics(/px$/.test(n.style.fontSize)?n.style.fontSize:j.fontSize).h,hb&&n.offsetHeight)),b.appendChild(n),o++,k))for(var e=e.replace(/([^\^])-/g,"$1- ").split(" "),u,t,p=a._clipHeight,E=[],v=y(l||16),s=1;e.length||E.length;)delete a.bBox,u=a.getBBox(),t=u.width,!W&&c.forExport&&(t=c.measureSpanWidth(n.firstChild.data,a.styles)),u=t>k,!u||e.length===1?(e=E,E=[],e.length&&(s++,p&&s*v>p?(e=["..."],a.attr("title",a.textStr)):(n=z.createElementNS(ya,"tspan"),
w(n,{dy:v,x:i}),r&&w(n,"style",r),b.appendChild(n),t>k&&(k=t)))):(n.removeChild(n.firstChild),E.unshift(e.pop())),e.length&&n.appendChild(z.createTextNode(e.join(" ").replace(/- /g,"-")))}})})},button:function(a,b,c,d,e,f,g,h,i){var j=this.label(a,b,c,i,null,null,null,null,"button"),k=0,l,m,p,q,n,o,a={x1:0,y1:0,x2:0,y2:1},e=x({"stroke-width":1,stroke:"#CCCCCC",fill:{linearGradient:a,stops:[[0,"#FEFEFE"],[1,"#F6F6F6"]]},r:2,padding:5,style:{color:"black"}},e);p=e.style;delete e.style;f=x(e,{stroke:"#68A",
fill:{linearGradient:a,stops:[[0,"#FFF"],[1,"#ACF"]]}},f);q=f.style;delete f.style;g=x(e,{stroke:"#68A",fill:{linearGradient:a,stops:[[0,"#9BD"],[1,"#CDF"]]}},g);n=g.style;delete g.style;h=x(e,{style:{color:"#CCC"}},h);o=h.style;delete h.style;K(j.element,sa?"mouseover":"mouseenter",function(){k!==3&&j.attr(f).css(q)});K(j.element,sa?"mouseout":"mouseleave",function(){k!==3&&(l=[e,f,g][k],m=[p,q,n][k],j.attr(l).css(m))});j.setState=function(a){(j.state=k=a)?a===2?j.attr(g).css(n):a===3&&j.attr(h).css(o):
j.attr(e).css(p)};return j.on("click",function(){k!==3&&d.call(j)}).attr(e).css(s({cursor:"default"},p))},crispLine:function(a,b){a[1]===a[4]&&(a[1]=a[4]=t(a[1])-b%2/2);a[2]===a[5]&&(a[2]=a[5]=t(a[2])+b%2/2);return a},path:function(a){var b={fill:S};Ia(a)?b.d=a:T(a)&&s(b,a);return this.createElement("path").attr(b)},circle:function(a,b,c){a=T(a)?a:{x:a,y:b,r:c};return this.createElement("circle").attr(a)},arc:function(a,b,c,d,e,f){if(T(a))b=a.y,c=a.r,d=a.innerR,e=a.start,f=a.end,a=a.x;a=this.symbol("arc",
a||0,b||0,c||0,c||0,{innerR:d||0,start:e||0,end:f||0});a.r=c;return a},rect:function(a,b,c,d,e,f){e=T(a)?a.r:e;e=this.createElement("rect").attr({rx:e,ry:e,fill:S});return e.attr(T(a)?a:e.crisp(f,a,b,r(c,0),r(d,0)))},setSize:function(a,b,c){var d=this.alignedObjects,e=d.length;this.width=a;this.height=b;for(this.boxWrapper[o(c,!0)?"animate":"attr"]({width:a,height:b});e--;)d[e].align()},g:function(a){var b=this.createElement("g");return u(a)?b.attr({"class":"highcharts-"+a}):b},image:function(a,b,
c,d,e){var f={preserveAspectRatio:S};arguments.length>1&&s(f,{x:b,y:c,width:d,height:e});f=this.createElement("image").attr(f);f.element.setAttributeNS?f.element.setAttributeNS("http://www.w3.org/1999/xlink","href",a):f.element.setAttribute("hc-svg-href",a);return f},symbol:function(a,b,c,d,e,f){var g,h=this.symbols[a],h=h&&h(t(b),t(c),d,e,f),i=/^url\((.*?)\)$/,j,k;if(h)g=this.path(h),s(g,{symbolName:a,x:b,y:c,width:d,height:e}),f&&s(g,f);else if(i.test(a))k=function(a,b){a.element&&(a.attr({width:b[0],
height:b[1]}),a.alignByTranslate||a.translate(t((d-b[0])/2),t((e-b[1])/2)))},j=a.match(i)[1],a=Pb[j],g=this.image(j).attr({x:b,y:c}),g.isImg=!0,a?k(g,a):(g.attr({width:0,height:0}),U("img",{onload:function(){k(g,Pb[j]=[this.width,this.height])},src:j}));return g},symbols:{circle:function(a,b,c,d){var e=0.166*c;return["M",a+c/2,b,"C",a+c+e,b,a+c+e,b+d,a+c/2,b+d,"C",a-e,b+d,a-e,b,a+c/2,b,"Z"]},square:function(a,b,c,d){return["M",a,b,"L",a+c,b,a+c,b+d,a,b+d,"Z"]},triangle:function(a,b,c,d){return["M",
a+c/2,b,"L",a+c,b+d,a,b+d,"Z"]},"triangle-down":function(a,b,c,d){return["M",a,b,"L",a+c,b,a+c/2,b+d,"Z"]},diamond:function(a,b,c,d){return["M",a+c/2,b,"L",a+c,b+d/2,a+c/2,b+d,a,b+d/2,"Z"]},arc:function(a,b,c,d,e){var f=e.start,c=e.r||c||d,g=e.end-0.001,d=e.innerR,h=e.open,i=V(f),j=ba(f),k=V(g),g=ba(g),e=e.end-f<xa?0:1;return["M",a+c*i,b+c*j,"A",c,c,0,e,1,a+c*k,b+c*g,h?"M":"L",a+d*k,b+d*g,"A",d,d,0,e,0,a+d*i,b+d*j,h?"":"Z"]}},clipRect:function(a,b,c,d){var e="highcharts-"+zb++,f=this.createElement("clipPath").attr({id:e}).add(this.defs),
a=this.rect(a,b,c,d,0).add(f);a.id=e;a.clipPath=f;return a},color:function(a,b,c){var d=this,e,f=/^rgba/,g,h,i,j,k,l,m,p=[];a&&a.linearGradient?g="linearGradient":a&&a.radialGradient&&(g="radialGradient");if(g){c=a[g];h=d.gradients;j=a.stops;b=b.radialReference;Ia(c)&&(a[g]=c={x1:c[0],y1:c[1],x2:c[2],y2:c[3],gradientUnits:"userSpaceOnUse"});g==="radialGradient"&&b&&!u(c.gradientUnits)&&(c=x(c,{cx:b[0]-b[2]/2+c.cx*b[2],cy:b[1]-b[2]/2+c.cy*b[2],r:c.r*b[2],gradientUnits:"userSpaceOnUse"}));for(m in c)m!==
"id"&&p.push(m,c[m]);for(m in j)p.push(j[m]);p=p.join(",");h[p]?a=h[p].id:(c.id=a="highcharts-"+zb++,h[p]=i=d.createElement(g).attr(c).add(d.defs),i.stops=[],n(j,function(a){f.test(a[1])?(e=qa(a[1]),k=e.get("rgb"),l=e.get("a")):(k=a[1],l=1);a=d.createElement("stop").attr({offset:a[0],"stop-color":k,"stop-opacity":l}).add(i);i.stops.push(a)}));return"url("+d.url+"#"+a+")"}else return f.test(a)?(e=qa(a),w(b,c+"-opacity",e.get("a")),e.get("rgb")):(b.removeAttribute(c+"-opacity"),a)},text:function(a,
b,c,d){var e=L.chart.style,f=ca||!W&&this.forExport;if(d&&!this.forExport)return this.html(a,b,c);b=t(o(b,0));c=t(o(c,0));a=this.createElement("text").attr({x:b,y:c,text:a}).css({fontFamily:e.fontFamily,fontSize:e.fontSize});f&&a.css({position:"absolute"});a.x=b;a.y=c;return a},html:function(a,b,c){var d=L.chart.style,e=this.createElement("span"),f=e.attrSetters,g=e.element,h=e.renderer;f.text=function(a){a!==g.innerHTML&&delete this.bBox;g.innerHTML=a;return!1};f.x=f.y=f.align=function(a,b){b===
"align"&&(b="textAlign");e[b]=a;e.htmlUpdateTransform();return!1};e.attr({text:a,x:t(b),y:t(c)}).css({position:"absolute",whiteSpace:"nowrap",fontFamily:d.fontFamily,fontSize:d.fontSize});e.css=e.htmlCss;if(h.isSVG)e.add=function(a){var b,c=h.box.parentNode,d=[];if(this.parentGroup=a){if(b=a.div,!b){for(;a;)d.push(a),a=a.parentGroup;n(d.reverse(),function(a){var d;b=a.div=a.div||U(Ea,{className:w(a.element,"class")},{position:"absolute",left:(a.translateX||0)+"px",top:(a.translateY||0)+"px"},b||c);
d=b.style;s(a.attrSetters,{translateX:function(a){d.left=a+"px"},translateY:function(a){d.top=a+"px"},visibility:function(a,b){d[b]=a}})})}}else b=c;b.appendChild(g);e.added=!0;e.alignOnAdd&&e.htmlUpdateTransform();return e};return e},fontMetrics:function(a){var a=y(a||11),a=a<24?a+4:t(a*1.2),b=t(a*0.8);return{h:a,b:b}},label:function(a,b,c,d,e,f,g,h,i){function j(){var a,b;a=o.element.style;O=(Oa===void 0||Ha===void 0||q.styles.textAlign)&&o.getBBox();q.width=(Oa||O.width||0)+2*da+lb;q.height=(Ha||
O.height||0)+2*da;w=da+p.fontMetrics(a&&a.fontSize).b;if(y){if(!B)a=t(-r*da),b=h?-w:0,q.box=B=d?p.symbol(d,a,b,q.width,q.height,Xa):p.rect(a,b,q.width,q.height,0,Xa[Rb]),B.add(q);B.isImg||B.attr(x({width:q.width,height:q.height},Xa));Xa=null}}function k(){var a=q.styles,a=a&&a.textAlign,b=lb+da*(1-r),c;c=h?0:w;if(u(Oa)&&(a==="center"||a==="right"))b+={center:0.5,right:1}[a]*(Oa-O.width);(b!==o.x||c!==o.y)&&o.attr({x:b,y:c});o.x=b;o.y=c}function l(a,b){B?B.attr(a,b):Xa[a]=b}function m(){o.add(q);q.attr({text:a,
x:b,y:c});B&&u(e)&&q.attr({anchorX:e,anchorY:f})}var p=this,q=p.g(i),o=p.text("",0,0,g).attr({zIndex:1}),B,O,r=0,da=3,lb=0,Oa,Ha,E,H,C=0,Xa={},w,g=q.attrSetters,y;K(q,"add",m);g.width=function(a){Oa=a;return!1};g.height=function(a){Ha=a;return!1};g.padding=function(a){u(a)&&a!==da&&(da=a,k());return!1};g.paddingLeft=function(a){u(a)&&a!==lb&&(lb=a,k());return!1};g.align=function(a){r={left:0,center:0.5,right:1}[a];return!1};g.text=function(a,b){o.attr(b,a);j();k();return!1};g[Rb]=function(a,b){y=
!0;C=a%2/2;l(b,a);return!1};g.stroke=g.fill=g.r=function(a,b){b==="fill"&&(y=!0);l(b,a);return!1};g.anchorX=function(a,b){e=a;l(b,a+C-E);return!1};g.anchorY=function(a,b){f=a;l(b,a-H);return!1};g.x=function(a){q.x=a;a-=r*((Oa||O.width)+da);E=t(a);q.attr("translateX",E);return!1};g.y=function(a){H=q.y=t(a);q.attr("translateY",H);return!1};var z=q.css;return s(q,{css:function(a){if(a){var b={},a=x(a);n("fontSize,fontWeight,fontFamily,color,lineHeight,width,textDecoration,textShadow".split(","),function(c){a[c]!==
v&&(b[c]=a[c],delete a[c])});o.css(b)}return z.call(q,a)},getBBox:function(){return{width:O.width+2*da,height:O.height+2*da,x:O.x-da,y:O.y-da}},shadow:function(a){B&&B.shadow(a);return q},destroy:function(){$(q,"add",m);$(q.element,"mouseenter");$(q.element,"mouseleave");o&&(o=o.destroy());B&&(B=B.destroy());va.prototype.destroy.call(q);q=p=j=k=l=m=null}})}};Va=za;var F;if(!W&&!ca){Highcharts.VMLElement=F={init:function(a,b){var c=["<",b,' filled="f" stroked="f"'],d=["position: ","absolute",";"],
e=b===Ea;(b==="shape"||e)&&d.push("left:0;top:0;width:1px;height:1px;");d.push("visibility: ",e?"hidden":"visible");c.push(' style="',d.join(""),'"/>');if(b)c=e||b==="span"||b==="img"?c.join(""):a.prepVML(c),this.element=U(c);this.renderer=a;this.attrSetters={}},add:function(a){var b=this.renderer,c=this.element,d=b.box,d=a?a.element||a:d;a&&a.inverted&&b.invertChild(c,d);d.appendChild(c);this.added=!0;this.alignOnAdd&&!this.deferUpdateTransform&&this.updateTransform();A(this,"add");return this},
updateTransform:va.prototype.htmlUpdateTransform,setSpanRotation:function(a,b,c){I(this.element,{filter:a?["progid:DXImageTransform.Microsoft.Matrix(M11=",c,", M12=",-b,", M21=",b,", M22=",c,", sizingMethod='auto expand')"].join(""):S})},pathToVML:function(a){for(var b=a.length,c=[],d;b--;)if(ra(a[b]))c[b]=t(a[b]*10)-5;else if(a[b]==="Z")c[b]="x";else if(c[b]=a[b],a.isArc&&(a[b]==="wa"||a[b]==="at"))d=a[b]==="wa"?1:-1,c[b+5]===c[b+7]&&(c[b+7]-=d),c[b+6]===c[b+8]&&(c[b+8]-=d);return c.join(" ")||"x"},
attr:function(a,b){var c,d,e,f=this.element||{},g=f.style,h=f.nodeName,i=this.renderer,j=this.symbolName,k,l=this.shadows,m,p=this.attrSetters,q=this;ea(a)&&u(b)&&(c=a,a={},a[c]=b);if(ea(a))c=a,q=c==="strokeWidth"||c==="stroke-width"?this.strokeweight:this[c];else for(c in a)if(d=a[c],m=!1,e=p[c]&&p[c].call(this,d,c),e!==!1&&d!==null){e!==v&&(d=e);if(j&&/^(x|y|r|start|end|width|height|innerR|anchorX|anchorY)/.test(c))k||(this.symbolAttr(a),k=!0),m=!0;else if(c==="d"){d=d||[];this.d=d.join(" ");f.path=
d=this.pathToVML(d);if(l)for(e=l.length;e--;)l[e].path=l[e].cutOff?this.cutOffPath(d,l[e].cutOff):d;m=!0}else if(c==="visibility"){if(l)for(e=l.length;e--;)l[e].style[c]=d;h==="DIV"&&(d=d==="hidden"?"-999em":0,gb||(g[c]=d?"visible":"hidden"),c="top");g[c]=d;m=!0}else if(c==="zIndex")d&&(g[c]=d),m=!0;else if(pa(c,["x","y","width","height"])!==-1)this[c]=d,c==="x"||c==="y"?c={x:"left",y:"top"}[c]:d=r(0,d),this.updateClipping?(this[c]=d,this.updateClipping()):g[c]=d,m=!0;else if(c==="class"&&h==="DIV")f.className=
d;else if(c==="stroke")d=i.color(d,f,c),c="strokecolor";else if(c==="stroke-width"||c==="strokeWidth")f.stroked=d?!0:!1,c="strokeweight",this[c]=d,ra(d)&&(d+="px");else if(c==="dashstyle")(f.getElementsByTagName("stroke")[0]||U(i.prepVML(["<stroke/>"]),null,null,f))[c]=d||"solid",this.dashstyle=d,m=!0;else if(c==="fill")if(h==="SPAN")g.color=d;else{if(h!=="IMG")f.filled=d!==S?!0:!1,d=i.color(d,f,c,this),c="fillcolor"}else if(c==="opacity")m=!0;else if(h==="shape"&&c==="rotation")this[c]=f.style[c]=
d,f.style.left=-t(ba(d*Ua)+1)+"px",f.style.top=t(V(d*Ua))+"px";else if(c==="translateX"||c==="translateY"||c==="rotation")this[c]=d,this.updateTransform(),m=!0;else if(c==="text")this.bBox=null,f.innerHTML=d,m=!0;m||(gb?f[c]=d:w(f,c,d))}return q},clip:function(a){var b=this,c;a?(c=a.members,ga(c,b),c.push(b),b.destroyClip=function(){ga(c,b)},a=a.getCSS(b)):(b.destroyClip&&b.destroyClip(),a={clip:gb?"inherit":"rect(auto)"});return b.css(a)},css:va.prototype.htmlCss,safeRemoveChild:function(a){a.parentNode&&
Ta(a)},destroy:function(){this.destroyClip&&this.destroyClip();return va.prototype.destroy.apply(this)},on:function(a,b){this.element["on"+a]=function(){var a=N.event;a.target=a.srcElement;b(a)};return this},cutOffPath:function(a,b){var c,a=a.split(/[ ,]/);c=a.length;if(c===9||c===11)a[c-4]=a[c-2]=y(a[c-2])-10*b;return a.join(" ")},shadow:function(a,b,c){var d=[],e,f=this.element,g=this.renderer,h,i=f.style,j,k=f.path,l,m,p,q;k&&typeof k.value!=="string"&&(k="x");m=k;if(a){p=o(a.width,3);q=(a.opacity||
0.15)/p;for(e=1;e<=3;e++){l=p*2+1-2*e;c&&(m=this.cutOffPath(k.value,l+0.5));j=['<shape isShadow="true" strokeweight="',l,'" filled="false" path="',m,'" coordsize="10 10" style="',f.style.cssText,'" />'];h=U(g.prepVML(j),null,{left:y(i.left)+o(a.offsetX,1),top:y(i.top)+o(a.offsetY,1)});if(c)h.cutOff=l+1;j=['<stroke color="',a.color||"black",'" opacity="',q*e,'"/>'];U(g.prepVML(j),null,null,h);b?b.element.appendChild(h):f.parentNode.insertBefore(h,f);d.push(h)}this.shadows=d}return this}};F=ha(va,F);
var la={Element:F,isIE8:na.indexOf("MSIE 8.0")>-1,init:function(a,b,c){var d,e;this.alignedObjects=[];d=this.createElement(Ea);e=d.element;e.style.position="relative";a.appendChild(d.element);this.isVML=!0;this.box=e;this.boxWrapper=d;this.setSize(b,c,!1);if(!z.namespaces.hcv){z.namespaces.add("hcv","urn:schemas-microsoft-com:vml");try{z.createStyleSheet().cssText="hcv\\:fill, hcv\\:path, hcv\\:shape, hcv\\:stroke{ behavior:url(#default#VML); display: inline-block; } "}catch(f){z.styleSheets[0].cssText+=
"hcv\\:fill, hcv\\:path, hcv\\:shape, hcv\\:stroke{ behavior:url(#default#VML); display: inline-block; } "}}},isHidden:function(){return!this.box.offsetWidth},clipRect:function(a,b,c,d){var e=this.createElement(),f=T(a);return s(e,{members:[],left:(f?a.x:a)+1,top:(f?a.y:b)+1,width:(f?a.width:c)-1,height:(f?a.height:d)-1,getCSS:function(a){var b=a.element,c=b.nodeName,a=a.inverted,d=this.top-(c==="shape"?b.offsetTop:0),e=this.left,b=e+this.width,f=d+this.height,d={clip:"rect("+t(a?e:d)+"px,"+t(a?f:
b)+"px,"+t(a?b:f)+"px,"+t(a?d:e)+"px)"};!a&&gb&&c==="DIV"&&s(d,{width:b+"px",height:f+"px"});return d},updateClipping:function(){n(e.members,function(a){a.css(e.getCSS(a))})}})},color:function(a,b,c,d){var e=this,f,g=/^rgba/,h,i,j=S;a&&a.linearGradient?i="gradient":a&&a.radialGradient&&(i="pattern");if(i){var k,l,m=a.linearGradient||a.radialGradient,p,q,o,B,O,r="",a=a.stops,u,t=[],v=function(){h=['<fill colors="'+t.join(",")+'" opacity="',o,'" o:opacity2="',q,'" type="',i,'" ',r,'focus="100%" method="any" />'];
U(e.prepVML(h),null,null,b)};p=a[0];u=a[a.length-1];p[0]>0&&a.unshift([0,p[1]]);u[0]<1&&a.push([1,u[1]]);n(a,function(a,b){g.test(a[1])?(f=qa(a[1]),k=f.get("rgb"),l=f.get("a")):(k=a[1],l=1);t.push(a[0]*100+"% "+k);b?(o=l,B=k):(q=l,O=k)});if(c==="fill")if(i==="gradient")c=m.x1||m[0]||0,a=m.y1||m[1]||0,p=m.x2||m[2]||0,m=m.y2||m[3]||0,r='angle="'+(90-R.atan((m-a)/(p-c))*180/xa)+'"',v();else{var j=m.r,s=j*2,E=j*2,H=m.cx,C=m.cy,x=b.radialReference,w,j=function(){x&&(w=d.getBBox(),H+=(x[0]-w.x)/w.width-
0.5,C+=(x[1]-w.y)/w.height-0.5,s*=x[2]/w.width,E*=x[2]/w.height);r='src="'+L.global.VMLRadialGradientURL+'" size="'+s+","+E+'" origin="0.5,0.5" position="'+H+","+C+'" color2="'+O+'" ';v()};d.added?j():K(d,"add",j);j=B}else j=k}else if(g.test(a)&&b.tagName!=="IMG")f=qa(a),h=["<",c,' opacity="',f.get("a"),'"/>'],U(this.prepVML(h),null,null,b),j=f.get("rgb");else{j=b.getElementsByTagName(c);if(j.length)j[0].opacity=1,j[0].type="solid";j=a}return j},prepVML:function(a){var b=this.isIE8,a=a.join("");b?
(a=a.replace("/>",' xmlns="urn:schemas-microsoft-com:vml" />'),a=a.indexOf('style="')===-1?a.replace("/>",' style="display:inline-block;behavior:url(#default#VML);" />'):a.replace('style="','style="display:inline-block;behavior:url(#default#VML);')):a=a.replace("<","<hcv:");return a},text:za.prototype.html,path:function(a){var b={coordsize:"10 10"};Ia(a)?b.d=a:T(a)&&s(b,a);return this.createElement("shape").attr(b)},circle:function(a,b,c){var d=this.symbol("circle");if(T(a))c=a.r,b=a.y,a=a.x;d.isCircle=
!0;d.r=c;return d.attr({x:a,y:b})},g:function(a){var b;a&&(b={className:"highcharts-"+a,"class":"highcharts-"+a});return this.createElement(Ea).attr(b)},image:function(a,b,c,d,e){var f=this.createElement("img").attr({src:a});arguments.length>1&&f.attr({x:b,y:c,width:d,height:e});return f},rect:function(a,b,c,d,e,f){var g=this.symbol("rect");g.r=T(a)?a.r:e;return g.attr(T(a)?a:g.crisp(f,a,b,r(c,0),r(d,0)))},invertChild:function(a,b){var c=b.style;I(a,{flip:"x",left:y(c.width)-1,top:y(c.height)-1,rotation:-90})},
symbols:{arc:function(a,b,c,d,e){var f=e.start,g=e.end,h=e.r||c||d,c=e.innerR,d=V(f),i=ba(f),j=V(g),k=ba(g);if(g-f===0)return["x"];f=["wa",a-h,b-h,a+h,b+h,a+h*d,b+h*i,a+h*j,b+h*k];e.open&&!c&&f.push("e","M",a,b);f.push("at",a-c,b-c,a+c,b+c,a+c*j,b+c*k,a+c*d,b+c*i,"x","e");f.isArc=!0;return f},circle:function(a,b,c,d,e){e&&(c=d=2*e.r);e&&e.isCircle&&(a-=c/2,b-=d/2);return["wa",a,b,a+c,b+d,a+c,b+d/2,a+c,b+d/2,"e"]},rect:function(a,b,c,d,e){var f=a+c,g=b+d,h;!u(e)||!e.r?f=za.prototype.symbols.square.apply(0,
arguments):(h=J(e.r,c,d),f=["M",a+h,b,"L",f-h,b,"wa",f-2*h,b,f,b+2*h,f-h,b,f,b+h,"L",f,g-h,"wa",f-2*h,g-2*h,f,g,f,g-h,f-h,g,"L",a+h,g,"wa",a,g-2*h,a+2*h,g,a+h,g,a,g-h,"L",a,b+h,"wa",a,b,a+2*h,b+2*h,a,b+h,a+h,b,"x","e"]);return f}}};Highcharts.VMLRenderer=F=function(){this.init.apply(this,arguments)};F.prototype=x(za.prototype,la);Va=F}za.prototype.measureSpanWidth=function(a,b){var c=z.createElement("span"),d=z.createTextNode(a);c.appendChild(d);I(c,b);this.box.appendChild(c);return c.offsetWidth};
var Tb;if(ca)Highcharts.CanVGRenderer=F=function(){ya="http://www.w3.org/1999/xhtml"},F.prototype.symbols={},Tb=function(){function a(){var a=b.length,d;for(d=0;d<a;d++)b[d]();b=[]}var b=[];return{push:function(c,d){b.length===0&&Vb(d,a);b.push(c)}}}(),Va=F;Ma.prototype={addLabel:function(){var a=this.axis,b=a.options,c=a.chart,d=a.horiz,e=a.categories,f=a.names,g=this.pos,h=b.labels,i=a.tickPositions,d=d&&e&&!h.step&&!h.staggerLines&&!h.rotation&&c.plotWidth/i.length||!d&&(c.margin[3]||c.chartWidth*
0.33),j=g===i[0],k=g===i[i.length-1],l,f=e?o(e[g],f[g],g):g,e=this.label,m=i.info;a.isDatetimeAxis&&m&&(l=b.dateTimeLabelFormats[m.higherRanks[g]||m.unitName]);this.isFirst=j;this.isLast=k;b=a.labelFormatter.call({axis:a,chart:c,isFirst:j,isLast:k,dateTimeLabelFormat:l,value:a.isLog?ia(fa(f)):f});g=d&&{width:r(1,t(d-2*(h.padding||10)))+"px"};g=s(g,h.style);if(u(e))e&&e.attr({text:b}).css(g);else{l={align:a.labelAlign};if(ra(h.rotation))l.rotation=h.rotation;if(d&&h.ellipsis)l._clipHeight=a.len/i.length;
this.label=u(b)&&h.enabled?c.renderer.text(b,0,0,h.useHTML).attr(l).css(g).add(a.labelGroup):null}},getLabelSize:function(){var a=this.label,b=this.axis;return a?(this.labelBBox=a.getBBox())[b.horiz?"height":"width"]:0},getLabelSides:function(){var a=this.axis,b=this.labelBBox.width,a=b*{left:0,center:0.5,right:1}[a.labelAlign]-a.options.labels.x;return[-a,b-a]},handleOverflow:function(a,b){var c=!0,d=this.axis,e=d.chart,f=this.isFirst,g=this.isLast,h=b.x,i=d.reversed,j=d.tickPositions;if(f||g){var k=
this.getLabelSides(),l=k[0],k=k[1],e=e.plotLeft,m=e+d.len,j=(d=d.ticks[j[a+(f?1:-1)]])&&d.label.xy&&d.label.xy.x+d.getLabelSides()[f?0:1];f&&!i||g&&i?h+l<e&&(h=e-l,d&&h+k>j&&(c=!1)):h+k>m&&(h=m-k,d&&h+l<j&&(c=!1));b.x=h}return c},getPosition:function(a,b,c,d){var e=this.axis,f=e.chart,g=d&&f.oldChartHeight||f.chartHeight;return{x:a?e.translate(b+c,null,null,d)+e.transB:e.left+e.offset+(e.opposite?(d&&f.oldChartWidth||f.chartWidth)-e.right-e.left:0),y:a?g-e.bottom+e.offset-(e.opposite?e.height:0):
g-e.translate(b+c,null,null,d)-e.transB}},getLabelPosition:function(a,b,c,d,e,f,g,h){var i=this.axis,j=i.transA,k=i.reversed,l=i.staggerLines,m=i.chart.renderer.fontMetrics(e.style.fontSize).b,p=e.rotation,a=a+e.x-(f&&d?f*j*(k?-1:1):0),b=b+e.y-(f&&!d?f*j*(k?1:-1):0);p&&i.side===2&&(b-=m-m*V(p*Ua));!u(e.y)&&!p&&(b+=m-c.getBBox().height/2);l&&(b+=g/(h||1)%l*(i.labelOffset/l));return{x:a,y:b}},getMarkPath:function(a,b,c,d,e,f){return f.crispLine(["M",a,b,"L",a+(e?0:-c),b+(e?c:0)],d)},render:function(a,
b,c){var d=this.axis,e=d.options,f=d.chart.renderer,g=d.horiz,h=this.type,i=this.label,j=this.pos,k=e.labels,l=this.gridLine,m=h?h+"Grid":"grid",p=h?h+"Tick":"tick",q=e[m+"LineWidth"],n=e[m+"LineColor"],B=e[m+"LineDashStyle"],r=e[p+"Length"],m=e[p+"Width"]||0,u=e[p+"Color"],t=e[p+"Position"],p=this.mark,s=k.step,w=!0,x=d.tickmarkOffset,E=this.getPosition(g,j,x,b),H=E.x,E=E.y,C=g&&H===d.pos+d.len||!g&&E===d.pos?-1:1,y=d.staggerLines;this.isActive=!0;if(q){j=d.getPlotLinePath(j+x,q*C,b,!0);if(l===v){l=
{stroke:n,"stroke-width":q};if(B)l.dashstyle=B;if(!h)l.zIndex=1;if(b)l.opacity=0;this.gridLine=l=q?f.path(j).attr(l).add(d.gridGroup):null}if(!b&&l&&j)l[this.isNew?"attr":"animate"]({d:j,opacity:c})}if(m&&r)t==="inside"&&(r=-r),d.opposite&&(r=-r),b=this.getMarkPath(H,E,r,m*C,g,f),p?p.animate({d:b,opacity:c}):this.mark=f.path(b).attr({stroke:u,"stroke-width":m,opacity:c}).add(d.axisGroup);if(i&&!isNaN(H))i.xy=E=this.getLabelPosition(H,E,i,g,k,x,a,s),this.isFirst&&!this.isLast&&!o(e.showFirstLabel,
1)||this.isLast&&!this.isFirst&&!o(e.showLastLabel,1)?w=!1:!y&&g&&k.overflow==="justify"&&!this.handleOverflow(a,E)&&(w=!1),s&&a%s&&(w=!1),w&&!isNaN(E.y)?(E.opacity=c,i[this.isNew?"attr":"animate"](E),this.isNew=!1):i.attr("y",-9999)},destroy:function(){Ka(this,this.axis)}};vb.prototype={render:function(){var a=this,b=a.axis,c=b.horiz,d=(b.pointRange||0)/2,e=a.options,f=e.label,g=a.label,h=e.width,i=e.to,j=e.from,k=u(j)&&u(i),l=e.value,m=e.dashStyle,p=a.svgElem,q=[],n,B=e.color,O=e.zIndex,t=e.events,
v=b.chart.renderer;b.isLog&&(j=ma(j),i=ma(i),l=ma(l));if(h){if(q=b.getPlotLinePath(l,h),d={stroke:B,"stroke-width":h},m)d.dashstyle=m}else if(k){if(j=r(j,b.min-d),i=J(i,b.max+d),q=b.getPlotBandPath(j,i,e),d={fill:B},e.borderWidth)d.stroke=e.borderColor,d["stroke-width"]=e.borderWidth}else return;if(u(O))d.zIndex=O;if(p)if(q)p.animate({d:q},null,p.onGetPath);else{if(p.hide(),p.onGetPath=function(){p.show()},g)a.label=g=g.destroy()}else if(q&&q.length&&(a.svgElem=p=v.path(q).attr(d).add(),t))for(n in e=
function(b){p.on(b,function(c){t[b].apply(a,[c])})},t)e(n);if(f&&u(f.text)&&q&&q.length&&b.width>0&&b.height>0){f=x({align:c&&k&&"center",x:c?!k&&4:10,verticalAlign:!c&&k&&"middle",y:c?k?16:10:k?6:-4,rotation:c&&!k&&90},f);if(!g)a.label=g=v.text(f.text,0,0,f.useHTML).attr({align:f.textAlign||f.align,rotation:f.rotation,zIndex:O}).css(f.style).add();b=[q[1],q[4],o(q[6],q[1])];q=[q[2],q[5],o(q[7],q[2])];c=Ja(b);k=Ja(q);g.align(f,!1,{x:c,y:k,width:ua(b)-c,height:ua(q)-k});g.show()}else g&&g.hide();return a},
destroy:function(){ga(this.axis.plotLinesAndBands,this);delete this.axis;Ka(this)}};Mb.prototype={destroy:function(){Ka(this,this.axis)},render:function(a){var b=this.options,c=b.format,c=c?Ca(c,this):b.formatter.call(this);this.label?this.label.attr({text:c,visibility:"hidden"}):this.label=this.axis.chart.renderer.text(c,0,0,b.useHTML).css(b.style).attr({align:this.textAlign,rotation:b.rotation,visibility:"hidden"}).add(a)},setOffset:function(a,b){var c=this.axis,d=c.chart,e=d.inverted,f=this.isNegative,
g=c.translate(this.percent?100:this.total,0,0,0,1),c=c.translate(0),c=M(g-c),h=d.xAxis[0].translate(this.x)+a,i=d.plotHeight,f={x:e?f?g:g-c:h,y:e?i-h-b:f?i-g-c:i-g,width:e?c:b,height:e?b:c};if(e=this.label)e.align(this.alignOptions,null,f),f=e.alignAttr,e.attr({visibility:this.options.crop===!1||d.isInsidePlot(f.x,f.y)?W?"inherit":"visible":"hidden"})}};eb.prototype={defaultOptions:{dateTimeLabelFormats:{millisecond:"%H:%M:%S.%L",second:"%H:%M:%S",minute:"%H:%M",hour:"%H:%M",day:"%e. %b",week:"%e. %b",
month:"%b '%y",year:"%Y"},endOnTick:!1,gridLineColor:"#C0C0C0",labels:G,lineColor:"#C0D0E0",lineWidth:1,minPadding:0.01,maxPadding:0.01,minorGridLineColor:"#E0E0E0",minorGridLineWidth:1,minorTickColor:"#A0A0A0",minorTickLength:2,minorTickPosition:"outside",startOfWeek:1,startOnTick:!1,tickColor:"#C0D0E0",tickLength:5,tickmarkPlacement:"between",tickPixelInterval:100,tickPosition:"outside",tickWidth:1,title:{align:"middle",style:{color:"#4d759e",fontWeight:"bold"}},type:"linear"},defaultYAxisOptions:{endOnTick:!0,
gridLineWidth:1,tickPixelInterval:72,showLastLabel:!0,labels:{x:-8,y:3},lineWidth:0,maxPadding:0.05,minPadding:0.05,startOnTick:!0,tickWidth:0,title:{rotation:270,text:"Values"},stackLabels:{enabled:!1,formatter:function(){return Aa(this.total,-1)},style:G.style}},defaultLeftAxisOptions:{labels:{x:-8,y:null},title:{rotation:270}},defaultRightAxisOptions:{labels:{x:8,y:null},title:{rotation:90}},defaultBottomAxisOptions:{labels:{x:0,y:14},title:{rotation:0}},defaultTopAxisOptions:{labels:{x:0,y:-5},
title:{rotation:0}},init:function(a,b){var c=b.isX;this.horiz=a.inverted?!c:c;this.xOrY=(this.isXAxis=c)?"x":"y";this.opposite=b.opposite;this.side=this.horiz?this.opposite?0:2:this.opposite?1:3;this.setOptions(b);var d=this.options,e=d.type;this.labelFormatter=d.labels.formatter||this.defaultLabelFormatter;this.userOptions=b;this.minPixelPadding=0;this.chart=a;this.reversed=d.reversed;this.zoomEnabled=d.zoomEnabled!==!1;this.categories=d.categories||e==="category";this.names=[];this.isLog=e==="logarithmic";
this.isDatetimeAxis=e==="datetime";this.isLinked=u(d.linkedTo);this.tickmarkOffset=this.categories&&d.tickmarkPlacement==="between"?0.5:0;this.ticks={};this.minorTicks={};this.plotLinesAndBands=[];this.alternateBands={};this.len=0;this.minRange=this.userMinRange=d.minRange||d.maxZoom;this.range=d.range;this.offset=d.offset||0;this.stacks={};this.oldStacks={};this.stackExtremes={};this.min=this.max=null;var f,d=this.options.events;pa(this,a.axes)===-1&&(a.axes.push(this),a[c?"xAxis":"yAxis"].push(this));
this.series=this.series||[];if(a.inverted&&c&&this.reversed===v)this.reversed=!0;this.removePlotLine=this.removePlotBand=this.removePlotBandOrLine;for(f in d)K(this,f,d[f]);if(this.isLog)this.val2lin=ma,this.lin2val=fa},setOptions:function(a){this.options=x(this.defaultOptions,this.isXAxis?{}:this.defaultYAxisOptions,[this.defaultTopAxisOptions,this.defaultRightAxisOptions,this.defaultBottomAxisOptions,this.defaultLeftAxisOptions][this.side],x(L[this.isXAxis?"xAxis":"yAxis"],a))},update:function(a,
b){var c=this.chart,a=c.options[this.xOrY+"Axis"][this.options.index]=x(this.userOptions,a);this.destroy(!0);this._addedPlotLB=this.userMin=this.userMax=v;this.init(c,s(a,{events:v}));c.isDirtyBox=!0;o(b,!0)&&c.redraw()},remove:function(a){var b=this.chart,c=this.xOrY+"Axis";n(this.series,function(a){a.remove(!1)});ga(b.axes,this);ga(b[c],this);b.options[c].splice(this.options.index,1);n(b[c],function(a,b){a.options.index=b});this.destroy();b.isDirtyBox=!0;o(a,!0)&&b.redraw()},defaultLabelFormatter:function(){var a=
this.axis,b=this.value,c=a.categories,d=this.dateTimeLabelFormat,e=L.lang.numericSymbols,f=e&&e.length,g,h=a.options.labels.format,a=a.isLog?b:a.tickInterval;if(h)g=Ca(h,this);else if(c)g=b;else if(d)g=Ya(d,b);else if(f&&a>=1E3)for(;f--&&g===v;)c=Math.pow(1E3,f+1),a>=c&&e[f]!==null&&(g=Aa(b/c,-1)+e[f]);g===v&&(g=b>=1E3?Aa(b,0):Aa(b,-1));return g},getSeriesExtremes:function(){var a=this,b=a.chart;a.hasVisibleSeries=!1;a.dataMin=a.dataMax=null;a.stackExtremes={};a.buildStacks();n(a.series,function(c){if(c.visible||
!b.options.chart.ignoreHiddenSeries){var d;d=c.options.threshold;var e;a.hasVisibleSeries=!0;a.isLog&&d<=0&&(d=null);if(a.isXAxis){if(d=c.xData,d.length)a.dataMin=J(o(a.dataMin,d[0]),Ja(d)),a.dataMax=r(o(a.dataMax,d[0]),ua(d))}else{c.getExtremes();e=c.dataMax;c=c.dataMin;if(u(c)&&u(e))a.dataMin=J(o(a.dataMin,c),c),a.dataMax=r(o(a.dataMax,e),e);if(u(d))if(a.dataMin>=d)a.dataMin=d,a.ignoreMinPadding=!0;else if(a.dataMax<d)a.dataMax=d,a.ignoreMaxPadding=!0}}})},translate:function(a,b,c,d,e,f){var g=
this.len,h=1,i=0,j=d?this.oldTransA:this.transA,d=d?this.oldMin:this.min,k=this.minPixelPadding,e=(this.options.ordinal||this.isLog&&e)&&this.lin2val;if(!j)j=this.transA;c&&(h*=-1,i=g);this.reversed&&(h*=-1,i-=h*g);b?(a=a*h+i,a-=k,a=a/j+d,e&&(a=this.lin2val(a))):(e&&(a=this.val2lin(a)),f==="between"&&(f=0.5),a=h*(a-d)*j+i+h*k+(ra(f)?j*f*this.pointRange:0));return a},toPixels:function(a,b){return this.translate(a,!1,!this.horiz,null,!0)+(b?0:this.pos)},toValue:function(a,b){return this.translate(a-
(b?0:this.pos),!0,!this.horiz,null,!0)},getPlotLinePath:function(a,b,c,d){var e=this.chart,f=this.left,g=this.top,h,i,j,a=this.translate(a,null,null,c),k=c&&e.oldChartHeight||e.chartHeight,l=c&&e.oldChartWidth||e.chartWidth,m;h=this.transB;c=i=t(a+h);h=j=t(k-a-h);if(isNaN(a))m=!0;else if(this.horiz){if(h=g,j=k-this.bottom,c<f||c>f+this.width)m=!0}else if(c=f,i=l-this.right,h<g||h>g+this.height)m=!0;return m&&!d?null:e.renderer.crispLine(["M",c,h,"L",i,j],b||0)},getPlotBandPath:function(a,b){var c=
this.getPlotLinePath(b),d=this.getPlotLinePath(a);d&&c?d.push(c[4],c[5],c[1],c[2]):d=null;return d},getLinearTickPositions:function(a,b,c){for(var d,b=ia(P(b/a)*a),c=ia(wa(c/a)*a),e=[];b<=c;){e.push(b);b=ia(b+a);if(b===d)break;d=b}return e},getLogTickPositions:function(a,b,c,d){var e=this.options,f=this.len,g=[];if(!d)this._minorAutoInterval=null;if(a>=0.5)a=t(a),g=this.getLinearTickPositions(a,b,c);else if(a>=0.08)for(var f=P(b),h,i,j,k,l,e=a>0.3?[1,2,4]:a>0.15?[1,2,4,6,8]:[1,2,3,4,5,6,7,8,9];f<
c+1&&!l;f++){i=e.length;for(h=0;h<i&&!l;h++)j=ma(fa(f)*e[h]),j>b&&(!d||k<=c)&&g.push(k),k>c&&(l=!0),k=j}else if(b=fa(b),c=fa(c),a=e[d?"minorTickInterval":"tickInterval"],a=o(a==="auto"?null:a,this._minorAutoInterval,(c-b)*(e.tickPixelInterval/(d?5:1))/((d?f/this.tickPositions.length:f)||1)),a=ob(a,null,nb(a)),g=Na(this.getLinearTickPositions(a,b,c),ma),!d)this._minorAutoInterval=a/5;if(!d)this.tickInterval=a;return g},getMinorTickPositions:function(){var a=this.options,b=this.tickPositions,c=this.minorTickInterval,
d=[],e;if(this.isLog){e=b.length;for(a=1;a<e;a++)d=d.concat(this.getLogTickPositions(c,b[a-1],b[a],!0))}else if(this.isDatetimeAxis&&a.minorTickInterval==="auto")d=d.concat(Eb(Cb(c),this.min,this.max,a.startOfWeek)),d[0]<this.min&&d.shift();else for(b=this.min+(b[0]-this.min)%c;b<=this.max;b+=c)d.push(b);return d},adjustForMinRange:function(){var a=this.options,b=this.min,c=this.max,d,e=this.dataMax-this.dataMin>=this.minRange,f,g,h,i,j;if(this.isXAxis&&this.minRange===v&&!this.isLog)u(a.min)||u(a.max)?
this.minRange=null:(n(this.series,function(a){i=a.xData;for(g=j=a.xIncrement?1:i.length-1;g>0;g--)if(h=i[g]-i[g-1],f===v||h<f)f=h}),this.minRange=J(f*5,this.dataMax-this.dataMin));if(c-b<this.minRange){var k=this.minRange;d=(k-c+b)/2;d=[b-d,o(a.min,b-d)];if(e)d[2]=this.dataMin;b=ua(d);c=[b+k,o(a.max,b+k)];if(e)c[2]=this.dataMax;c=Ja(c);c-b<k&&(d[0]=c-k,d[1]=o(a.min,c-k),b=ua(d))}this.min=b;this.max=c},setAxisTranslation:function(a){var b=this.max-this.min,c=0,d,e=0,f=0,g=this.linkedParent,h=this.transA;
if(this.isXAxis)g?(e=g.minPointOffset,f=g.pointRangePadding):n(this.series,function(a){var g=a.pointRange,h=a.options.pointPlacement,l=a.closestPointRange;g>b&&(g=0);c=r(c,g);e=r(e,ea(h)?0:g/2);f=r(f,h==="on"?0:g);!a.noSharedTooltip&&u(l)&&(d=u(d)?J(d,l):l)}),g=this.ordinalSlope&&d?this.ordinalSlope/d:1,this.minPointOffset=e*=g,this.pointRangePadding=f*=g,this.pointRange=J(c,b),this.closestPointRange=d;if(a)this.oldTransA=h;this.translationSlope=this.transA=h=this.len/(b+f||1);this.transB=this.horiz?
this.left:this.bottom;this.minPixelPadding=h*e},setTickPositions:function(a){var b=this,c=b.chart,d=b.options,e=b.isLog,f=b.isDatetimeAxis,g=b.isXAxis,h=b.isLinked,i=b.options.tickPositioner,j=d.maxPadding,k=d.minPadding,l=d.tickInterval,m=d.minTickInterval,p=d.tickPixelInterval,q,aa=b.categories;h?(b.linkedParent=c[g?"xAxis":"yAxis"][d.linkedTo],c=b.linkedParent.getExtremes(),b.min=o(c.min,c.dataMin),b.max=o(c.max,c.dataMax),d.type!==b.linkedParent.options.type&&ka(11,1)):(b.min=o(b.userMin,d.min,
b.dataMin),b.max=o(b.userMax,d.max,b.dataMax));if(e)!a&&J(b.min,o(b.dataMin,b.min))<=0&&ka(10,1),b.min=ia(ma(b.min)),b.max=ia(ma(b.max));if(b.range&&(b.userMin=b.min=r(b.min,b.max-b.range),b.userMax=b.max,a))b.range=null;b.beforePadding&&b.beforePadding();b.adjustForMinRange();if(!aa&&!b.usePercentage&&!h&&u(b.min)&&u(b.max)&&(c=b.max-b.min)){if(!u(d.min)&&!u(b.userMin)&&k&&(b.dataMin<0||!b.ignoreMinPadding))b.min-=c*k;if(!u(d.max)&&!u(b.userMax)&&j&&(b.dataMax>0||!b.ignoreMaxPadding))b.max+=c*j}b.min===
b.max||b.min===void 0||b.max===void 0?b.tickInterval=1:h&&!l&&p===b.linkedParent.options.tickPixelInterval?b.tickInterval=b.linkedParent.tickInterval:(b.tickInterval=o(l,aa?1:(b.max-b.min)*p/r(b.len,p)),!u(l)&&b.len<p&&!this.isRadial&&(q=!0,b.tickInterval/=4));g&&!a&&n(b.series,function(a){a.processData(b.min!==b.oldMin||b.max!==b.oldMax)});b.setAxisTranslation(!0);b.beforeSetTickPositions&&b.beforeSetTickPositions();if(b.postProcessTickInterval)b.tickInterval=b.postProcessTickInterval(b.tickInterval);
if(b.pointRange)b.tickInterval=r(b.pointRange,b.tickInterval);if(!l&&b.tickInterval<m)b.tickInterval=m;if(!f&&!e&&!l)b.tickInterval=ob(b.tickInterval,null,nb(b.tickInterval),d);b.minorTickInterval=d.minorTickInterval==="auto"&&b.tickInterval?b.tickInterval/5:d.minorTickInterval;b.tickPositions=a=d.tickPositions?[].concat(d.tickPositions):i&&i.apply(b,[b.min,b.max]);if(!a)!b.ordinalPositions&&(b.max-b.min)/b.tickInterval>r(2*b.len,200)&&ka(19,!0),a=f?(b.getNonLinearTimeTicks||Eb)(Cb(b.tickInterval,
d.units),b.min,b.max,d.startOfWeek,b.ordinalPositions,b.closestPointRange,!0):e?b.getLogTickPositions(b.tickInterval,b.min,b.max):b.getLinearTickPositions(b.tickInterval,b.min,b.max),q&&a.splice(1,a.length-2),b.tickPositions=a;if(!h)e=a[0],f=a[a.length-1],h=b.minPointOffset||0,d.startOnTick?b.min=e:b.min-h>e&&a.shift(),d.endOnTick?b.max=f:b.max+h<f&&a.pop(),a.length===1&&(b.min-=0.001,b.max+=0.001)},setMaxTicks:function(){var a=this.chart,b=a.maxTicks||{},c=this.tickPositions,d=this._maxTicksKey=
[this.xOrY,this.pos,this.len].join("-");if(!this.isLinked&&!this.isDatetimeAxis&&c&&c.length>(b[d]||0)&&this.options.alignTicks!==!1)b[d]=c.length;a.maxTicks=b},adjustTickAmount:function(){var a=this._maxTicksKey,b=this.tickPositions,c=this.chart.maxTicks;if(c&&c[a]&&!this.isDatetimeAxis&&!this.categories&&!this.isLinked&&this.options.alignTicks!==!1){var d=this.tickAmount,e=b.length;this.tickAmount=a=c[a];if(e<a){for(;b.length<a;)b.push(ia(b[b.length-1]+this.tickInterval));this.transA*=(e-1)/(a-
1);this.max=b[b.length-1]}if(u(d)&&a!==d)this.isDirty=!0}},setScale:function(){var a=this.stacks,b,c,d,e;this.oldMin=this.min;this.oldMax=this.max;this.oldAxisLength=this.len;this.setAxisSize();e=this.len!==this.oldAxisLength;n(this.series,function(a){if(a.isDirtyData||a.isDirty||a.xAxis.isDirty)d=!0});if(e||d||this.isLinked||this.forceRedraw||this.userMin!==this.oldUserMin||this.userMax!==this.oldUserMax){if(!this.isXAxis)for(b in a)for(c in a[b])a[b][c].total=null,a[b][c].cum=0;this.forceRedraw=
!1;this.getSeriesExtremes();this.setTickPositions();this.oldUserMin=this.userMin;this.oldUserMax=this.userMax;if(!this.isDirty)this.isDirty=e||this.min!==this.oldMin||this.max!==this.oldMax}else if(!this.isXAxis){if(this.oldStacks)a=this.stacks=this.oldStacks;for(b in a)for(c in a[b])a[b][c].cum=a[b][c].total}this.setMaxTicks()},setExtremes:function(a,b,c,d,e){var f=this,g=f.chart,c=o(c,!0),e=s(e,{min:a,max:b});A(f,"setExtremes",e,function(){f.userMin=a;f.userMax=b;f.eventArgs=e;f.isDirtyExtremes=
!0;c&&g.redraw(d)})},zoom:function(a,b){this.allowZoomOutside||(u(this.dataMin)&&a<=this.dataMin&&(a=v),u(this.dataMax)&&b>=this.dataMax&&(b=v));this.displayBtn=a!==v||b!==v;this.setExtremes(a,b,!1,v,{trigger:"zoom"});return!0},setAxisSize:function(){var a=this.chart,b=this.options,c=b.offsetLeft||0,d=b.offsetRight||0,e=this.horiz,f,g;this.left=g=o(b.left,a.plotLeft+c);this.top=f=o(b.top,a.plotTop);this.width=c=o(b.width,a.plotWidth-c+d);this.height=b=o(b.height,a.plotHeight);this.bottom=a.chartHeight-
b-f;this.right=a.chartWidth-c-g;this.len=r(e?c:b,0);this.pos=e?g:f},getExtremes:function(){var a=this.isLog;return{min:a?ia(fa(this.min)):this.min,max:a?ia(fa(this.max)):this.max,dataMin:this.dataMin,dataMax:this.dataMax,userMin:this.userMin,userMax:this.userMax}},getThreshold:function(a){var b=this.isLog,c=b?fa(this.min):this.min,b=b?fa(this.max):this.max;c>a||a===null?a=c:b<a&&(a=b);return this.translate(a,0,1,0,1)},addPlotBand:function(a){this.addPlotBandOrLine(a,"plotBands")},addPlotLine:function(a){this.addPlotBandOrLine(a,
"plotLines")},addPlotBandOrLine:function(a,b){var c=(new vb(this,a)).render(),d=this.userOptions;c&&(b&&(d[b]=d[b]||[],d[b].push(a)),this.plotLinesAndBands.push(c));return c},autoLabelAlign:function(a){a=(o(a,0)-this.side*90+720)%360;return a>15&&a<165?"right":a>195&&a<345?"left":"center"},getOffset:function(){var a=this,b=a.chart,c=b.renderer,d=a.options,e=a.tickPositions,f=a.ticks,g=a.horiz,h=a.side,i=b.inverted?[1,0,3,2][h]:h,j,k=0,l,m=0,p=d.title,q=d.labels,aa=0,B=b.axisOffset,t=b.clipOffset,
s=[-1,1,1,-1][h],w,x=1,y=o(q.maxStaggerLines,5),Ha,E,H,C;a.hasData=j=a.hasVisibleSeries||u(a.min)&&u(a.max)&&!!e;a.showAxis=b=j||o(d.showEmpty,!0);a.staggerLines=a.horiz&&q.staggerLines;if(!a.axisGroup)a.gridGroup=c.g("grid").attr({zIndex:d.gridZIndex||1}).add(),a.axisGroup=c.g("axis").attr({zIndex:d.zIndex||2}).add(),a.labelGroup=c.g("axis-labels").attr({zIndex:q.zIndex||7}).add();if(j||a.isLinked){a.labelAlign=o(q.align||a.autoLabelAlign(q.rotation));n(e,function(b){f[b]?f[b].addLabel():f[b]=new Ma(a,
b)});if(a.horiz&&!a.staggerLines&&y&&!q.rotation){for(w=a.reversed?[].concat(e).reverse():e;x<y;){j=[];Ha=!1;for(q=0;q<w.length;q++)E=w[q],H=(H=f[E].label&&f[E].label.getBBox())?H.width:0,C=q%x,H&&(E=a.translate(E),j[C]!==v&&E<j[C]&&(Ha=!0),j[C]=E+H);if(Ha)x++;else break}if(x>1)a.staggerLines=x}n(e,function(b){if(h===0||h===2||{1:"left",3:"right"}[h]===a.labelAlign)aa=r(f[b].getLabelSize(),aa)});if(a.staggerLines)aa*=a.staggerLines,a.labelOffset=aa}else for(w in f)f[w].destroy(),delete f[w];if(p&&
p.text&&p.enabled!==!1){if(!a.axisTitle)a.axisTitle=c.text(p.text,0,0,p.useHTML).attr({zIndex:7,rotation:p.rotation||0,align:p.textAlign||{low:"left",middle:"center",high:"right"}[p.align]}).css(p.style).add(a.axisGroup),a.axisTitle.isNew=!0;if(b)k=a.axisTitle.getBBox()[g?"height":"width"],m=o(p.margin,g?5:10),l=p.offset;a.axisTitle[b?"show":"hide"]()}a.offset=s*o(d.offset,B[h]);a.axisTitleMargin=o(l,aa+m+(h!==2&&aa&&s*d.labels[g?"y":"x"]));B[h]=r(B[h],a.axisTitleMargin+k+s*a.offset);t[i]=r(t[i],
P(d.lineWidth/2)*2)},getLinePath:function(a){var b=this.chart,c=this.opposite,d=this.offset,e=this.horiz,f=this.left+(c?this.width:0)+d,d=b.chartHeight-this.bottom-(c?this.height:0)+d;c&&(a*=-1);return b.renderer.crispLine(["M",e?this.left:f,e?d:this.top,"L",e?b.chartWidth-this.right:f,e?d:b.chartHeight-this.bottom],a)},getTitlePosition:function(){var a=this.horiz,b=this.left,c=this.top,d=this.len,e=this.options.title,f=a?b:c,g=this.opposite,h=this.offset,i=y(e.style.fontSize||12),d={low:f+(a?0:d),
middle:f+d/2,high:f+(a?d:0)}[e.align],b=(a?c+this.height:b)+(a?1:-1)*(g?-1:1)*this.axisTitleMargin+(this.side===2?i:0);return{x:a?d:b+(g?this.width:0)+h+(e.x||0),y:a?b-(g?this.height:0)+h:d+(e.y||0)}},render:function(){var a=this,b=a.chart,c=b.renderer,d=a.options,e=a.isLog,f=a.isLinked,g=a.tickPositions,h=a.axisTitle,i=a.stacks,j=a.ticks,k=a.minorTicks,l=a.alternateBands,m=d.stackLabels,p=d.alternateGridColor,q=a.tickmarkOffset,o=d.lineWidth,B,r=b.hasRendered&&u(a.oldMin)&&!isNaN(a.oldMin);B=a.hasData;
var t=a.showAxis,s,w;n([j,k,l],function(a){for(var b in a)a[b].isActive=!1});if(B||f)if(a.minorTickInterval&&!a.categories&&n(a.getMinorTickPositions(),function(b){k[b]||(k[b]=new Ma(a,b,"minor"));r&&k[b].isNew&&k[b].render(null,!0);k[b].render(null,!1,1)}),g.length&&(n(g.slice(1).concat([g[0]]),function(b,c){c=c===g.length-1?0:c+1;if(!f||b>=a.min&&b<=a.max)j[b]||(j[b]=new Ma(a,b)),r&&j[b].isNew&&j[b].render(c,!0),j[b].render(c,!1,1)}),q&&a.min===0&&(j[-1]||(j[-1]=new Ma(a,-1,null,!0)),j[-1].render(-1))),
p&&n(g,function(b,c){if(c%2===0&&b<a.max)l[b]||(l[b]=new vb(a)),s=b+q,w=g[c+1]!==v?g[c+1]+q:a.max,l[b].options={from:e?fa(s):s,to:e?fa(w):w,color:p},l[b].render(),l[b].isActive=!0}),!a._addedPlotLB)n((d.plotLines||[]).concat(d.plotBands||[]),function(b){a.addPlotBandOrLine(b)}),a._addedPlotLB=!0;n([j,k,l],function(a){var c,d,e=[],f=Fa?Fa.duration||500:0,g=function(){for(d=e.length;d--;)a[e[d]]&&!a[e[d]].isActive&&(a[e[d]].destroy(),delete a[e[d]])};for(c in a)if(!a[c].isActive)a[c].render(c,!1,0),
a[c].isActive=!1,e.push(c);a===l||!b.hasRendered||!f?g():f&&setTimeout(g,f)});if(o)B=a.getLinePath(o),a.axisLine?a.axisLine.animate({d:B}):a.axisLine=c.path(B).attr({stroke:d.lineColor,"stroke-width":o,zIndex:7}).add(a.axisGroup),a.axisLine[t?"show":"hide"]();if(h&&t)h[h.isNew?"attr":"animate"](a.getTitlePosition()),h.isNew=!1;if(m&&m.enabled){var x,y,d=a.stackTotalGroup;if(!d)a.stackTotalGroup=d=c.g("stack-labels").attr({visibility:"visible",zIndex:6}).add();d.translate(b.plotLeft,b.plotTop);for(x in i)for(y in c=
i[x],c)c[y].render(d)}a.isDirty=!1},removePlotBandOrLine:function(a){for(var b=this.plotLinesAndBands,c=this.options,d=this.userOptions,e=b.length;e--;)b[e].id===a&&b[e].destroy();n([c.plotLines||[],d.plotLines||[],c.plotBands||[],d.plotBands||[]],function(b){for(e=b.length;e--;)b[e].id===a&&ga(b,b[e])})},setTitle:function(a,b){this.update({title:a},b)},redraw:function(){var a=this.chart.pointer;a.reset&&a.reset(!0);this.render();n(this.plotLinesAndBands,function(a){a.render()});n(this.series,function(a){a.isDirty=
!0})},buildStacks:function(){var a=this.series,b=a.length;if(!this.isXAxis){for(;b--;)a[b].setStackedPoints();if(this.usePercentage)for(b=0;b<a.length;b++)a[b].setPercentStacks()}},setCategories:function(a,b){this.update({categories:a},b)},destroy:function(a){var b=this,c=b.stacks,d,e=b.plotLinesAndBands;a||$(b);for(d in c)Ka(c[d]),c[d]=null;n([b.ticks,b.minorTicks,b.alternateBands],function(a){Ka(a)});for(a=e.length;a--;)e[a].destroy();n("stackTotalGroup,axisLine,axisGroup,gridGroup,labelGroup,axisTitle".split(","),
function(a){b[a]&&(b[a]=b[a].destroy())})}};wb.prototype={init:function(a,b){var c=b.borderWidth,d=b.style,e=y(d.padding);this.chart=a;this.options=b;this.crosshairs=[];this.now={x:0,y:0};this.isHidden=!0;this.label=a.renderer.label("",0,0,b.shape,null,null,b.useHTML,null,"tooltip").attr({padding:e,fill:b.backgroundColor,"stroke-width":c,r:b.borderRadius,zIndex:8}).css(d).css({padding:0}).add().attr({y:-999});ca||this.label.shadow(b.shadow);this.shared=b.shared},destroy:function(){n(this.crosshairs,
function(a){a&&a.destroy()});if(this.label)this.label=this.label.destroy();clearTimeout(this.hideTimer);clearTimeout(this.tooltipTimeout)},move:function(a,b,c,d){var e=this,f=e.now,g=e.options.animation!==!1&&!e.isHidden;s(f,{x:g?(2*f.x+a)/3:a,y:g?(f.y+b)/2:b,anchorX:g?(2*f.anchorX+c)/3:c,anchorY:g?(f.anchorY+d)/2:d});e.label.attr(f);if(g&&(M(a-f.x)>1||M(b-f.y)>1))clearTimeout(this.tooltipTimeout),this.tooltipTimeout=setTimeout(function(){e&&e.move(a,b,c,d)},32)},hide:function(){var a=this,b;clearTimeout(this.hideTimer);
if(!this.isHidden)b=this.chart.hoverPoints,this.hideTimer=setTimeout(function(){a.label.fadeOut();a.isHidden=!0},o(this.options.hideDelay,500)),b&&n(b,function(a){a.setState()}),this.chart.hoverPoints=null},hideCrosshairs:function(){n(this.crosshairs,function(a){a&&a.hide()})},getAnchor:function(a,b){var c,d=this.chart,e=d.inverted,f=d.plotTop,g=0,h=0,i,a=ja(a);c=a[0].tooltipPos;this.followPointer&&b&&(b.chartX===v&&(b=d.pointer.normalize(b)),c=[b.chartX-d.plotLeft,b.chartY-f]);c||(n(a,function(a){i=
a.series.yAxis;g+=a.plotX;h+=(a.plotLow?(a.plotLow+a.plotHigh)/2:a.plotY)+(!e&&i?i.top-f:0)}),g/=a.length,h/=a.length,c=[e?d.plotWidth-h:g,this.shared&&!e&&a.length>1&&b?b.chartY-f:e?d.plotHeight-g:h]);return Na(c,t)},getPosition:function(a,b,c){var d=this.chart,e=d.plotLeft,f=d.plotTop,g=d.plotWidth,h=d.plotHeight,i=o(this.options.distance,12),j=c.plotX,c=c.plotY,d=j+e+(d.inverted?i:-a-i),k=c-b+f+15,l;d<7&&(d=e+r(j,0)+i);d+a>e+g&&(d-=d+a-(e+g),k=c-b+f-i,l=!0);k<f+5&&(k=f+5,l&&c>=k&&c<=k+b&&(k=c+
f+i));k+b>f+h&&(k=r(f,f+h-b-i));return{x:d,y:k}},defaultFormatter:function(a){var b=this.points||ja(this),c=b[0].series,d;d=[c.tooltipHeaderFormatter(b[0])];n(b,function(a){c=a.series;d.push(c.tooltipFormatter&&c.tooltipFormatter(a)||a.point.tooltipFormatter(c.tooltipOptions.pointFormat))});d.push(a.options.footerFormat||"");return d.join("")},refresh:function(a,b){var c=this.chart,d=this.label,e=this.options,f,g,h={},i,j=[];i=e.formatter||this.defaultFormatter;var h=c.hoverPoints,k,l=e.crosshairs,
m=this.shared;clearTimeout(this.hideTimer);this.followPointer=ja(a)[0].series.tooltipOptions.followPointer;g=this.getAnchor(a,b);f=g[0];g=g[1];m&&(!a.series||!a.series.noSharedTooltip)?(c.hoverPoints=a,h&&n(h,function(a){a.setState()}),n(a,function(a){a.setState("hover");j.push(a.getLabelConfig())}),h={x:a[0].category,y:a[0].y},h.points=j,a=a[0]):h=a.getLabelConfig();i=i.call(h,this);h=a.series;i===!1?this.hide():(this.isHidden&&(Wa(d),d.attr("opacity",1).show()),d.attr({text:i}),k=e.borderColor||
a.color||h.color||"#606060",d.attr({stroke:k}),this.updatePosition({plotX:f,plotY:g}),this.isHidden=!1);if(l){l=ja(l);for(d=l.length;d--;)if(m=a.series,e=m[d?"yAxis":"xAxis"],l[d]&&e)if(h=d?o(a.stackY,a.y):a.x,e.isLog&&(h=ma(h)),d===1&&m.modifyValue&&(h=m.modifyValue(h)),e=e.getPlotLinePath(h,1),this.crosshairs[d])this.crosshairs[d].attr({d:e,visibility:"visible"});else{h={"stroke-width":l[d].width||1,stroke:l[d].color||"#C0C0C0",zIndex:l[d].zIndex||2};if(l[d].dashStyle)h.dashstyle=l[d].dashStyle;
this.crosshairs[d]=c.renderer.path(e).attr(h).add()}}A(c,"tooltipRefresh",{text:i,x:f+c.plotLeft,y:g+c.plotTop,borderColor:k})},updatePosition:function(a){var b=this.chart,c=this.label,c=(this.options.positioner||this.getPosition).call(this,c.width,c.height,a);this.move(t(c.x),t(c.y),a.plotX+b.plotLeft,a.plotY+b.plotTop)}};xb.prototype={init:function(a,b){var c=b.chart,d=c.events,e=ca?"":c.zoomType,c=a.inverted,f;this.options=b;this.chart=a;this.zoomX=f=/x/.test(e);this.zoomY=e=/y/.test(e);this.zoomHor=
f&&!c||e&&c;this.zoomVert=e&&!c||f&&c;this.runChartClick=d&&!!d.click;this.pinchDown=[];this.lastValidTouch={};if(b.tooltip.enabled)a.tooltip=new wb(a,b.tooltip);this.setDOMEvents()},normalize:function(a,b){var c,d,a=a||N.event;if(!a.target)a.target=a.srcElement;a=Xb(a);d=a.touches?a.touches.item(0):a;if(!b)this.chartPosition=b=Wb(this.chart.container);d.pageX===v?(c=r(a.x,a.clientX-b.left),d=a.y):(c=d.pageX-b.left,d=d.pageY-b.top);return s(a,{chartX:t(c),chartY:t(d)})},getCoordinates:function(a){var b=
{xAxis:[],yAxis:[]};n(this.chart.axes,function(c){b[c.isXAxis?"xAxis":"yAxis"].push({axis:c,value:c.toValue(a[c.horiz?"chartX":"chartY"])})});return b},getIndex:function(a){var b=this.chart;return b.inverted?b.plotHeight+b.plotTop-a.chartY:a.chartX-b.plotLeft},runPointActions:function(a){var b=this.chart,c=b.series,d=b.tooltip,e,f=b.hoverPoint,g=b.hoverSeries,h,i,j=b.chartWidth,k=this.getIndex(a);if(d&&this.options.tooltip.shared&&(!g||!g.noSharedTooltip)){e=[];h=c.length;for(i=0;i<h;i++)if(c[i].visible&&
c[i].options.enableMouseTracking!==!1&&!c[i].noSharedTooltip&&c[i].tooltipPoints.length&&(b=c[i].tooltipPoints[k])&&b.series)b._dist=M(k-b.clientX),j=J(j,b._dist),e.push(b);for(h=e.length;h--;)e[h]._dist>j&&e.splice(h,1);if(e.length&&e[0].clientX!==this.hoverX)d.refresh(e,a),this.hoverX=e[0].clientX}if(g&&g.tracker){if((b=g.tooltipPoints[k])&&b!==f)b.onMouseOver(a)}else d&&d.followPointer&&!d.isHidden&&(a=d.getAnchor([{}],a),d.updatePosition({plotX:a[0],plotY:a[1]}))},reset:function(a){var b=this.chart,
c=b.hoverSeries,d=b.hoverPoint,e=b.tooltip,b=e&&e.shared?b.hoverPoints:d;(a=a&&e&&b)&&ja(b)[0].plotX===v&&(a=!1);if(a)e.refresh(b);else{if(d)d.onMouseOut();if(c)c.onMouseOut();e&&(e.hide(),e.hideCrosshairs());this.hoverX=null}},scaleGroups:function(a,b){var c=this.chart,d;n(c.series,function(e){d=a||e.getPlotBox();e.xAxis&&e.xAxis.zoomEnabled&&(e.group.attr(d),e.markerGroup&&(e.markerGroup.attr(d),e.markerGroup.clip(b?c.clipRect:null)),e.dataLabelsGroup&&e.dataLabelsGroup.attr(d))});c.clipRect.attr(b||
c.clipBox)},pinchTranslate:function(a,b,c,d,e,f,g,h){a&&this.pinchTranslateDirection(!0,c,d,e,f,g,h);b&&this.pinchTranslateDirection(!1,c,d,e,f,g,h)},pinchTranslateDirection:function(a,b,c,d,e,f,g,h){var i=this.chart,j=a?"x":"y",k=a?"X":"Y",l="chart"+k,m=a?"width":"height",p=i["plot"+(a?"Left":"Top")],q,o,n=h||1,r=i.inverted,t=i.bounds[a?"h":"v"],u=b.length===1,s=b[0][l],v=c[0][l],w=!u&&b[1][l],x=!u&&c[1][l],y,c=function(){!u&&M(s-w)>20&&(n=h||M(v-x)/M(s-w));o=(p-v)/n+s;q=i["plot"+(a?"Width":"Height")]/
n};c();b=o;b<t.min?(b=t.min,y=!0):b+q>t.max&&(b=t.max-q,y=!0);y?(v-=0.8*(v-g[j][0]),u||(x-=0.8*(x-g[j][1])),c()):g[j]=[v,x];r||(f[j]=o-p,f[m]=q);f=r?1/n:n;e[m]=q;e[j]=b;d[r?a?"scaleY":"scaleX":"scale"+k]=n;d["translate"+k]=f*p+(v-f*s)},pinch:function(a){var b=this,c=b.chart,d=b.pinchDown,e=c.tooltip&&c.tooltip.options.followTouchMove,f=a.touches,g=f.length,h=b.lastValidTouch,i=b.zoomHor||b.pinchHor,j=b.zoomVert||b.pinchVert,k=i||j,l=b.selectionMarker,m={},p=g===1&&(b.inClass(a.target,"highcharts-tracker")&&
c.runTrackerClick||c.runChartClick),q={};(k||e)&&!p&&a.preventDefault();Na(f,function(a){return b.normalize(a)});if(a.type==="touchstart")n(f,function(a,b){d[b]={chartX:a.chartX,chartY:a.chartY}}),h.x=[d[0].chartX,d[1]&&d[1].chartX],h.y=[d[0].chartY,d[1]&&d[1].chartY],n(c.axes,function(a){if(a.zoomEnabled){var b=c.bounds[a.horiz?"h":"v"],d=a.minPixelPadding,e=a.toPixels(a.dataMin),f=a.toPixels(a.dataMax),g=J(e,f),e=r(e,f);b.min=J(a.pos,g-d);b.max=r(a.pos+a.len,e+d)}});else if(d.length){if(!l)b.selectionMarker=
l=s({destroy:oa},c.plotBox);b.pinchTranslate(i,j,d,f,m,l,q,h);b.hasPinched=k;b.scaleGroups(m,q);!k&&e&&g===1&&this.runPointActions(b.normalize(a))}},dragStart:function(a){var b=this.chart;b.mouseIsDown=a.type;b.cancelClick=!1;b.mouseDownX=this.mouseDownX=a.chartX;b.mouseDownY=this.mouseDownY=a.chartY},drag:function(a){var b=this.chart,c=b.options.chart,d=a.chartX,e=a.chartY,f=this.zoomHor,g=this.zoomVert,h=b.plotLeft,i=b.plotTop,j=b.plotWidth,k=b.plotHeight,l,m=this.mouseDownX,p=this.mouseDownY;d<
h?d=h:d>h+j&&(d=h+j);e<i?e=i:e>i+k&&(e=i+k);this.hasDragged=Math.sqrt(Math.pow(m-d,2)+Math.pow(p-e,2));if(this.hasDragged>10){l=b.isInsidePlot(m-h,p-i);if(b.hasCartesianSeries&&(this.zoomX||this.zoomY)&&l&&!this.selectionMarker)this.selectionMarker=b.renderer.rect(h,i,f?1:j,g?1:k,0).attr({fill:c.selectionMarkerFill||"rgba(69,114,167,0.25)",zIndex:7}).add();this.selectionMarker&&f&&(d-=m,this.selectionMarker.attr({width:M(d),x:(d>0?0:d)+m}));this.selectionMarker&&g&&(d=e-p,this.selectionMarker.attr({height:M(d),
y:(d>0?0:d)+p}));l&&!this.selectionMarker&&c.panning&&b.pan(a,c.panning)}},drop:function(a){var b=this.chart,c=this.hasPinched;if(this.selectionMarker){var d={xAxis:[],yAxis:[],originalEvent:a.originalEvent||a},e=this.selectionMarker,f=e.x,g=e.y,h;if(this.hasDragged||c)n(b.axes,function(a){if(a.zoomEnabled){var b=a.horiz,c=a.toValue(b?f:g),b=a.toValue(b?f+e.width:g+e.height);!isNaN(c)&&!isNaN(b)&&(d[a.xOrY+"Axis"].push({axis:a,min:J(c,b),max:r(c,b)}),h=!0)}}),h&&A(b,"selection",d,function(a){b.zoom(s(a,
c?{animation:!1}:null))});this.selectionMarker=this.selectionMarker.destroy();c&&this.scaleGroups()}if(b)I(b.container,{cursor:b._cursor}),b.cancelClick=this.hasDragged>10,b.mouseIsDown=this.hasDragged=this.hasPinched=!1,this.pinchDown=[]},onContainerMouseDown:function(a){a=this.normalize(a);a.preventDefault&&a.preventDefault();this.dragStart(a)},onDocumentMouseUp:function(a){this.drop(a)},onDocumentMouseMove:function(a){var b=this.chart,c=this.chartPosition,d=b.hoverSeries,a=this.normalize(a,c);
c&&d&&!this.inClass(a.target,"highcharts-tracker")&&!b.isInsidePlot(a.chartX-b.plotLeft,a.chartY-b.plotTop)&&this.reset()},onContainerMouseLeave:function(){this.reset();this.chartPosition=null},onContainerMouseMove:function(a){var b=this.chart,a=this.normalize(a);a.returnValue=!1;b.mouseIsDown==="mousedown"&&this.drag(a);(this.inClass(a.target,"highcharts-tracker")||b.isInsidePlot(a.chartX-b.plotLeft,a.chartY-b.plotTop))&&!b.openMenu&&this.runPointActions(a)},inClass:function(a,b){for(var c;a;){if(c=
w(a,"class"))if(c.indexOf(b)!==-1)return!0;else if(c.indexOf("highcharts-container")!==-1)return!1;a=a.parentNode}},onTrackerMouseOut:function(a){var b=this.chart.hoverSeries;if(b&&!b.options.stickyTracking&&!this.inClass(a.toElement||a.relatedTarget,"highcharts-tooltip"))b.onMouseOut()},onContainerClick:function(a){var b=this.chart,c=b.hoverPoint,d=b.plotLeft,e=b.plotTop,f=b.inverted,g,h,i,a=this.normalize(a);a.cancelBubble=!0;if(!b.cancelClick)c&&this.inClass(a.target,"highcharts-tracker")?(g=this.chartPosition,
h=c.plotX,i=c.plotY,s(c,{pageX:g.left+d+(f?b.plotWidth-i:h),pageY:g.top+e+(f?b.plotHeight-h:i)}),A(c.series,"click",s(a,{point:c})),b.hoverPoint&&c.firePointEvent("click",a)):(s(a,this.getCoordinates(a)),b.isInsidePlot(a.chartX-d,a.chartY-e)&&A(b,"click",a))},onContainerTouchStart:function(a){var b=this.chart;a.touches.length===1?(a=this.normalize(a),b.isInsidePlot(a.chartX-b.plotLeft,a.chartY-b.plotTop)?(this.runPointActions(a),this.pinch(a)):this.reset()):a.touches.length===2&&this.pinch(a)},onContainerTouchMove:function(a){(a.touches.length===
1||a.touches.length===2)&&this.pinch(a)},onDocumentTouchEnd:function(a){this.drop(a)},setDOMEvents:function(){var a=this,b=a.chart.container,c;this._events=c=[[b,"onmousedown","onContainerMouseDown"],[b,"onmousemove","onContainerMouseMove"],[b,"onclick","onContainerClick"],[b,"mouseleave","onContainerMouseLeave"],[z,"mousemove","onDocumentMouseMove"],[z,"mouseup","onDocumentMouseUp"]];jb&&c.push([b,"ontouchstart","onContainerTouchStart"],[b,"ontouchmove","onContainerTouchMove"],[z,"touchend","onDocumentTouchEnd"]);
n(c,function(b){a["_"+b[2]]=function(c){a[b[2]](c)};b[1].indexOf("on")===0?b[0][b[1]]=a["_"+b[2]]:K(b[0],b[1],a["_"+b[2]])})},destroy:function(){var a=this;n(a._events,function(b){b[1].indexOf("on")===0?b[0][b[1]]=null:$(b[0],b[1],a["_"+b[2]])});delete a._events;clearInterval(a.tooltipTimeout)}};fb.prototype={init:function(a,b){var c=this,d=b.itemStyle,e=o(b.padding,8),f=b.itemMarginTop||0;this.options=b;if(b.enabled)c.baseline=y(d.fontSize)+3+f,c.itemStyle=d,c.itemHiddenStyle=x(d,b.itemHiddenStyle),
c.itemMarginTop=f,c.padding=e,c.initialItemX=e,c.initialItemY=e-5,c.maxItemWidth=0,c.chart=a,c.itemHeight=0,c.lastLineHeight=0,c.render(),K(c.chart,"endResize",function(){c.positionCheckboxes()})},colorizeItem:function(a,b){var c=this.options,d=a.legendItem,e=a.legendLine,f=a.legendSymbol,g=this.itemHiddenStyle.color,c=b?c.itemStyle.color:g,h=b?a.color:g,g=a.options&&a.options.marker,i={stroke:h,fill:h},j;d&&d.css({fill:c,color:c});e&&e.attr({stroke:h});if(f){if(g&&f.isMarker)for(j in g=a.convertAttribs(g),
g)d=g[j],d!==v&&(i[j]=d);f.attr(i)}},positionItem:function(a){var b=this.options,c=b.symbolPadding,b=!b.rtl,d=a._legendItemPos,e=d[0],d=d[1],f=a.checkbox;a.legendGroup&&a.legendGroup.translate(b?e:this.legendWidth-e-2*c-4,d);if(f)f.x=e,f.y=d},destroyItem:function(a){var b=a.checkbox;n(["legendItem","legendLine","legendSymbol","legendGroup"],function(b){a[b]&&(a[b]=a[b].destroy())});b&&Ta(a.checkbox)},destroy:function(){var a=this.group,b=this.box;if(b)this.box=b.destroy();if(a)this.group=a.destroy()},
positionCheckboxes:function(a){var b=this.group.alignAttr,c,d=this.clipHeight||this.legendHeight;if(b)c=b.translateY,n(this.allItems,function(e){var f=e.checkbox,g;f&&(g=c+f.y+(a||0)+3,I(f,{left:b.translateX+e.legendItemWidth+f.x-20+"px",top:g+"px",display:g>c-6&&g<c+d-6?"":S}))})},renderTitle:function(){var a=this.padding,b=this.options.title,c=0;if(b.text){if(!this.title)this.title=this.chart.renderer.label(b.text,a-3,a-4,null,null,null,null,null,"legend-title").attr({zIndex:1}).css(b.style).add(this.group);
a=this.title.getBBox();c=a.height;this.offsetWidth=a.width;this.contentGroup.attr({translateY:c})}this.titleHeight=c},renderItem:function(a){var C;var b=this,c=b.chart,d=c.renderer,e=b.options,f=e.layout==="horizontal",g=e.symbolWidth,h=e.symbolPadding,i=b.itemStyle,j=b.itemHiddenStyle,k=b.padding,l=f?o(e.itemDistance,8):0,m=!e.rtl,p=e.width,q=e.itemMarginBottom||0,n=b.itemMarginTop,B=b.initialItemX,t=a.legendItem,u=a.series||a,s=u.options,v=s.showCheckbox,w=e.useHTML;if(!t&&(a.legendGroup=d.g("legend-item").attr({zIndex:1}).add(b.scrollGroup),
u.drawLegendSymbol(b,a),a.legendItem=t=d.text(e.labelFormat?Ca(e.labelFormat,a):e.labelFormatter.call(a),m?g+h:-h,b.baseline,w).css(x(a.visible?i:j)).attr({align:m?"left":"right",zIndex:2}).add(a.legendGroup),(w?t:a.legendGroup).on("mouseover",function(){a.setState("hover");t.css(b.options.itemHoverStyle)}).on("mouseout",function(){t.css(a.visible?i:j);a.setState()}).on("click",function(b){var c=function(){a.setVisible()},b={browserEvent:b};a.firePointEvent?a.firePointEvent("legendItemClick",b,c):
A(a,"legendItemClick",b,c)}),b.colorizeItem(a,a.visible),s&&v))a.checkbox=U("input",{type:"checkbox",checked:a.selected,defaultChecked:a.selected},e.itemCheckboxStyle,c.container),K(a.checkbox,"click",function(b){A(a,"checkboxClick",{checked:b.target.checked},function(){a.select()})});d=t.getBBox();C=a.legendItemWidth=e.itemWidth||g+h+d.width+l+(v?20:0),e=C;b.itemHeight=g=d.height;if(f&&b.itemX-B+e>(p||c.chartWidth-2*k-B))b.itemX=B,b.itemY+=n+b.lastLineHeight+q,b.lastLineHeight=0;b.maxItemWidth=r(b.maxItemWidth,
e);b.lastItemY=n+b.itemY+q;b.lastLineHeight=r(g,b.lastLineHeight);a._legendItemPos=[b.itemX,b.itemY];f?b.itemX+=e:(b.itemY+=n+g+q,b.lastLineHeight=g);b.offsetWidth=p||r((f?b.itemX-B-l:e)+k,b.offsetWidth)},render:function(){var a=this,b=a.chart,c=b.renderer,d=a.group,e,f,g,h,i=a.box,j=a.options,k=a.padding,l=j.borderWidth,m=j.backgroundColor;a.itemX=a.initialItemX;a.itemY=a.initialItemY;a.offsetWidth=0;a.lastItemY=0;if(!d)a.group=d=c.g("legend").attr({zIndex:7}).add(),a.contentGroup=c.g().attr({zIndex:1}).add(d),
a.scrollGroup=c.g().add(a.contentGroup);a.renderTitle();e=[];n(b.series,function(a){var b=a.options;if(o(b.showInLegend,b.linkedTo===v?v:!1,!0))e=e.concat(a.legendItems||(b.legendType==="point"?a.data:a))});Kb(e,function(a,b){return(a.options&&a.options.legendIndex||0)-(b.options&&b.options.legendIndex||0)});j.reversed&&e.reverse();a.allItems=e;a.display=f=!!e.length;n(e,function(b){a.renderItem(b)});g=j.width||a.offsetWidth;h=a.lastItemY+a.lastLineHeight+a.titleHeight;h=a.handleOverflow(h);if(l||
m){g+=k;h+=k;if(i){if(g>0&&h>0)i[i.isNew?"attr":"animate"](i.crisp(null,null,null,g,h)),i.isNew=!1}else a.box=i=c.rect(0,0,g,h,j.borderRadius,l||0).attr({stroke:j.borderColor,"stroke-width":l||0,fill:m||S}).add(d).shadow(j.shadow),i.isNew=!0;i[f?"show":"hide"]()}a.legendWidth=g;a.legendHeight=h;n(e,function(b){a.positionItem(b)});f&&d.align(s({width:g,height:h},j),!0,"spacingBox");b.isResizing||this.positionCheckboxes()},handleOverflow:function(a){var b=this,c=this.chart,d=c.renderer,e=this.options,
f=e.y,f=c.spacingBox.height+(e.verticalAlign==="top"?-f:f)-this.padding,g=e.maxHeight,h=this.clipRect,i=e.navigation,j=o(i.animation,!0),k=i.arrowSize||12,l=this.nav;e.layout==="horizontal"&&(f/=2);g&&(f=J(f,g));if(a>f&&!e.useHTML){this.clipHeight=c=f-20-this.titleHeight;this.pageCount=wa(a/c);this.currentPage=o(this.currentPage,1);this.fullHeight=a;if(!h)h=b.clipRect=d.clipRect(0,0,9999,0),b.contentGroup.clip(h);h.attr({height:c});if(!l)this.nav=l=d.g().attr({zIndex:1}).add(this.group),this.up=d.symbol("triangle",
0,0,k,k).on("click",function(){b.scroll(-1,j)}).add(l),this.pager=d.text("",15,10).css(i.style).add(l),this.down=d.symbol("triangle-down",0,0,k,k).on("click",function(){b.scroll(1,j)}).add(l);b.scroll(0);a=f}else if(l)h.attr({height:c.chartHeight}),l.hide(),this.scrollGroup.attr({translateY:1}),this.clipHeight=0;return a},scroll:function(a,b){var c=this.pageCount,d=this.currentPage+a,e=this.clipHeight,f=this.options.navigation,g=f.activeColor,h=f.inactiveColor,f=this.pager,i=this.padding;d>c&&(d=
c);if(d>0)b!==v&&La(b,this.chart),this.nav.attr({translateX:i,translateY:e+7+this.titleHeight,visibility:"visible"}),this.up.attr({fill:d===1?h:g}).css({cursor:d===1?"default":"pointer"}),f.attr({text:d+"/"+this.pageCount}),this.down.attr({x:18+this.pager.getBBox().width,fill:d===c?h:g}).css({cursor:d===c?"default":"pointer"}),e=-J(e*(d-1),this.fullHeight-e+i)+1,this.scrollGroup.animate({translateY:e}),f.attr({text:d+"/"+c}),this.currentPage=d,this.positionCheckboxes(e)}};/Trident\/7\.0/.test(na)&&
mb(fb.prototype,"positionItem",function(a,b){var c=this,d=function(){a.call(c,b)};c.chart.renderer.forExport?d():setTimeout(d)});yb.prototype={init:function(a,b){var c,d=a.series;a.series=null;c=x(L,a);c.series=a.series=d;d=c.chart;this.margin=this.splashArray("margin",d);this.spacing=this.splashArray("spacing",d);var e=d.events;this.bounds={h:{},v:{}};this.callback=b;this.isResizing=0;this.options=c;this.axes=[];this.series=[];this.hasCartesianSeries=d.showAxes;var f=this,g;f.index=Ga.length;Ga.push(f);
d.reflow!==!1&&K(f,"load",function(){f.initReflow()});if(e)for(g in e)K(f,g,e[g]);f.xAxis=[];f.yAxis=[];f.animation=ca?!1:o(d.animation,!0);f.pointCount=0;f.counters=new Jb;f.firstRender()},initSeries:function(a){var b=this.options.chart;(b=X[a.type||b.type||b.defaultSeriesType])||ka(17,!0);b=new b;b.init(this,a);return b},addSeries:function(a,b,c){var d,e=this;a&&(b=o(b,!0),A(e,"addSeries",{options:a},function(){d=e.initSeries(a);e.isDirtyLegend=!0;e.linkSeries();b&&e.redraw(c)}));return d},addAxis:function(a,
b,c,d){var e=b?"xAxis":"yAxis",f=this.options;new eb(this,x(a,{index:this[e].length,isX:b}));f[e]=ja(f[e]||{});f[e].push(a);o(c,!0)&&this.redraw(d)},isInsidePlot:function(a,b,c){var d=c?b:a,a=c?a:b;return d>=0&&d<=this.plotWidth&&a>=0&&a<=this.plotHeight},adjustTickAmounts:function(){this.options.chart.alignTicks!==!1&&n(this.axes,function(a){a.adjustTickAmount()});this.maxTicks=null},redraw:function(a){var b=this.axes,c=this.series,d=this.pointer,e=this.legend,f=this.isDirtyLegend,g,h,i=this.isDirtyBox,
j=c.length,k=j,l=this.renderer,m=l.isHidden(),p=[];La(a,this);m&&this.cloneRenderTo();for(this.layOutTitles();k--;)if(a=c[k],a.options.stacking&&(g=!0,a.isDirty)){h=!0;break}if(h)for(k=j;k--;)if(a=c[k],a.options.stacking)a.isDirty=!0;n(c,function(a){a.isDirty&&a.options.legendType==="point"&&(f=!0)});if(f&&e.options.enabled)e.render(),this.isDirtyLegend=!1;g&&this.getStacks();if(this.hasCartesianSeries){if(!this.isResizing)this.maxTicks=null,n(b,function(a){a.setScale()});this.adjustTickAmounts();
this.getMargins();n(b,function(a){a.isDirty&&(i=!0)});n(b,function(a){if(a.isDirtyExtremes)a.isDirtyExtremes=!1,p.push(function(){A(a,"afterSetExtremes",s(a.eventArgs,a.getExtremes()));delete a.eventArgs});(i||g)&&a.redraw()})}i&&this.drawChartBox();n(c,function(a){a.isDirty&&a.visible&&(!a.isCartesian||a.xAxis)&&a.redraw()});d&&d.reset&&d.reset(!0);l.draw();A(this,"redraw");m&&this.cloneRenderTo(!0);n(p,function(a){a.call()})},showLoading:function(a){var b=this.options,c=this.loadingDiv,d=b.loading;
if(!c)this.loadingDiv=c=U(Ea,{className:"highcharts-loading"},s(d.style,{zIndex:10,display:S}),this.container),this.loadingSpan=U("span",null,d.labelStyle,c);this.loadingSpan.innerHTML=a||b.lang.loading;if(!this.loadingShown)I(c,{opacity:0,display:"",left:this.plotLeft+"px",top:this.plotTop+"px",width:this.plotWidth+"px",height:this.plotHeight+"px"}),Bb(c,{opacity:d.style.opacity},{duration:d.showDuration||0}),this.loadingShown=!0},hideLoading:function(){var a=this.options,b=this.loadingDiv;b&&Bb(b,
{opacity:0},{duration:a.loading.hideDuration||100,complete:function(){I(b,{display:S})}});this.loadingShown=!1},get:function(a){var b=this.axes,c=this.series,d,e;for(d=0;d<b.length;d++)if(b[d].options.id===a)return b[d];for(d=0;d<c.length;d++)if(c[d].options.id===a)return c[d];for(d=0;d<c.length;d++){e=c[d].points||[];for(b=0;b<e.length;b++)if(e[b].id===a)return e[b]}return null},getAxes:function(){var a=this,b=this.options,c=b.xAxis=ja(b.xAxis||{}),b=b.yAxis=ja(b.yAxis||{});n(c,function(a,b){a.index=
b;a.isX=!0});n(b,function(a,b){a.index=b});c=c.concat(b);n(c,function(b){new eb(a,b)});a.adjustTickAmounts()},getSelectedPoints:function(){var a=[];n(this.series,function(b){a=a.concat(ub(b.points||[],function(a){return a.selected}))});return a},getSelectedSeries:function(){return ub(this.series,function(a){return a.selected})},getStacks:function(){var a=this;n(a.yAxis,function(a){if(a.stacks&&a.hasVisibleSeries)a.oldStacks=a.stacks});n(a.series,function(b){if(b.options.stacking&&(b.visible===!0||
a.options.chart.ignoreHiddenSeries===!1))b.stackKey=b.type+o(b.options.stack,"")})},showResetZoom:function(){var a=this,b=L.lang,c=a.options.chart.resetZoomButton,d=c.theme,e=d.states,f=c.relativeTo==="chart"?null:"plotBox";this.resetZoomButton=a.renderer.button(b.resetZoom,null,null,function(){a.zoomOut()},d,e&&e.hover).attr({align:c.position.align,title:b.resetZoomTitle}).add().align(c.position,!1,f)},zoomOut:function(){var a=this;A(a,"selection",{resetSelection:!0},function(){a.zoom()})},zoom:function(a){var b,
c=this.pointer,d=!1,e;!a||a.resetSelection?n(this.axes,function(a){b=a.zoom()}):n(a.xAxis.concat(a.yAxis),function(a){var e=a.axis,h=e.isXAxis;if(c[h?"zoomX":"zoomY"]||c[h?"pinchX":"pinchY"])b=e.zoom(a.min,a.max),e.displayBtn&&(d=!0)});e=this.resetZoomButton;if(d&&!e)this.showResetZoom();else if(!d&&T(e))this.resetZoomButton=e.destroy();b&&this.redraw(o(this.options.chart.animation,a&&a.animation,this.pointCount<100))},pan:function(a,b){var c=this,d=c.hoverPoints,e;d&&n(d,function(a){a.setState()});
n(b==="xy"?[1,0]:[1],function(b){var d=a[b?"chartX":"chartY"],h=c[b?"xAxis":"yAxis"][0],i=c[b?"mouseDownX":"mouseDownY"],j=(h.pointRange||0)/2,k=h.getExtremes(),l=h.toValue(i-d,!0)+j,i=h.toValue(i+c[b?"plotWidth":"plotHeight"]-d,!0)-j;h.series.length&&l>J(k.dataMin,k.min)&&i<r(k.dataMax,k.max)&&(h.setExtremes(l,i,!1,!1,{trigger:"pan"}),e=!0);c[b?"mouseDownX":"mouseDownY"]=d});e&&c.redraw(!1);I(c.container,{cursor:"move"})},setTitle:function(a,b){var f;var c=this,d=c.options,e;e=d.title=x(d.title,
a);f=d.subtitle=x(d.subtitle,b),d=f;n([["title",a,e],["subtitle",b,d]],function(a){var b=a[0],d=c[b],e=a[1],a=a[2];d&&e&&(c[b]=d=d.destroy());a&&a.text&&!d&&(c[b]=c.renderer.text(a.text,0,0,a.useHTML).attr({align:a.align,"class":"highcharts-"+b,zIndex:a.zIndex||4}).css(a.style).add())});c.layOutTitles()},layOutTitles:function(){var a=0,b=this.title,c=this.subtitle,d=this.options,e=d.title,d=d.subtitle,f=this.spacingBox.width-44;if(b&&(b.css({width:(e.width||f)+"px"}).align(s({y:15},e),!1,"spacingBox"),
!e.floating&&!e.verticalAlign))a=b.getBBox().height,a>=18&&a<=25&&(a=15);c&&(c.css({width:(d.width||f)+"px"}).align(s({y:a+e.margin},d),!1,"spacingBox"),!d.floating&&!d.verticalAlign&&(a=wa(a+c.getBBox().height)));this.titleOffset=a},getChartSize:function(){var a=this.options.chart,b=this.renderToClone||this.renderTo;this.containerWidth=kb(b,"width");this.containerHeight=kb(b,"height");this.chartWidth=r(0,a.width||this.containerWidth||600);this.chartHeight=r(0,o(a.height,this.containerHeight>19?this.containerHeight:
400))},cloneRenderTo:function(a){var b=this.renderToClone,c=this.container;a?b&&(this.renderTo.appendChild(c),Ta(b),delete this.renderToClone):(c&&c.parentNode===this.renderTo&&this.renderTo.removeChild(c),this.renderToClone=b=this.renderTo.cloneNode(0),I(b,{position:"absolute",top:"-9999px",display:"block"}),z.body.appendChild(b),c&&b.appendChild(c))},getContainer:function(){var a,b=this.options.chart,c,d,e;this.renderTo=a=b.renderTo;e="highcharts-"+zb++;if(ea(a))this.renderTo=a=z.getElementById(a);
a||ka(13,!0);c=y(w(a,"data-highcharts-chart"));!isNaN(c)&&Ga[c]&&Ga[c].destroy();w(a,"data-highcharts-chart",this.index);a.innerHTML="";a.offsetWidth||this.cloneRenderTo();this.getChartSize();c=this.chartWidth;d=this.chartHeight;this.container=a=U(Ea,{className:"highcharts-container"+(b.className?" "+b.className:""),id:e},s({position:"relative",overflow:"hidden",width:c+"px",height:d+"px",textAlign:"left",lineHeight:"normal",zIndex:0,"-webkit-tap-highlight-color":"rgba(0,0,0,0)"},b.style),this.renderToClone||
a);this._cursor=a.style.cursor;this.renderer=b.forExport?new za(a,c,d,!0):new Va(a,c,d);ca&&this.renderer.create(this,a,c,d)},getMargins:function(){var a=this.spacing,b,c=this.legend,d=this.margin,e=this.options.legend,f=o(e.margin,10),g=e.x,h=e.y,i=e.align,j=e.verticalAlign,k=this.titleOffset;this.resetMargins();b=this.axisOffset;if(k&&!u(d[0]))this.plotTop=r(this.plotTop,k+this.options.title.margin+a[0]);if(c.display&&!e.floating)if(i==="right"){if(!u(d[1]))this.marginRight=r(this.marginRight,c.legendWidth-
g+f+a[1])}else if(i==="left"){if(!u(d[3]))this.plotLeft=r(this.plotLeft,c.legendWidth+g+f+a[3])}else if(j==="top"){if(!u(d[0]))this.plotTop=r(this.plotTop,c.legendHeight+h+f+a[0])}else if(j==="bottom"&&!u(d[2]))this.marginBottom=r(this.marginBottom,c.legendHeight-h+f+a[2]);this.extraBottomMargin&&(this.marginBottom+=this.extraBottomMargin);this.extraTopMargin&&(this.plotTop+=this.extraTopMargin);this.hasCartesianSeries&&n(this.axes,function(a){a.getOffset()});u(d[3])||(this.plotLeft+=b[3]);u(d[0])||
(this.plotTop+=b[0]);u(d[2])||(this.marginBottom+=b[2]);u(d[1])||(this.marginRight+=b[1]);this.setChartSize()},initReflow:function(){function a(a){var g=c.width||kb(d,"width"),h=c.height||kb(d,"height"),a=a?a.target:N;if(!b.hasUserSize&&g&&h&&(a===N||a===z)){if(g!==b.containerWidth||h!==b.containerHeight)clearTimeout(e),b.reflowTimeout=e=setTimeout(function(){if(b.container)b.setSize(g,h,!1),b.hasUserSize=null},100);b.containerWidth=g;b.containerHeight=h}}var b=this,c=b.options.chart,d=b.renderTo,
e;b.reflow=a;K(N,"resize",a);K(b,"destroy",function(){$(N,"resize",a)})},setSize:function(a,b,c){var d=this,e,f,g;d.isResizing+=1;g=function(){d&&A(d,"endResize",null,function(){d.isResizing-=1})};La(c,d);d.oldChartHeight=d.chartHeight;d.oldChartWidth=d.chartWidth;if(u(a))d.chartWidth=e=r(0,t(a)),d.hasUserSize=!!e;if(u(b))d.chartHeight=f=r(0,t(b));I(d.container,{width:e+"px",height:f+"px"});d.setChartSize(!0);d.renderer.setSize(e,f,c);d.maxTicks=null;n(d.axes,function(a){a.isDirty=!0;a.setScale()});
n(d.series,function(a){a.isDirty=!0});d.isDirtyLegend=!0;d.isDirtyBox=!0;d.getMargins();d.redraw(c);d.oldChartHeight=null;A(d,"resize");Fa===!1?g():setTimeout(g,Fa&&Fa.duration||500)},setChartSize:function(a){var b=this.inverted,c=this.renderer,d=this.chartWidth,e=this.chartHeight,f=this.options.chart,g=this.spacing,h=this.clipOffset,i,j,k,l;this.plotLeft=i=t(this.plotLeft);this.plotTop=j=t(this.plotTop);this.plotWidth=k=r(0,t(d-i-this.marginRight));this.plotHeight=l=r(0,t(e-j-this.marginBottom));
this.plotSizeX=b?l:k;this.plotSizeY=b?k:l;this.plotBorderWidth=f.plotBorderWidth||0;this.spacingBox=c.spacingBox={x:g[3],y:g[0],width:d-g[3]-g[1],height:e-g[0]-g[2]};this.plotBox=c.plotBox={x:i,y:j,width:k,height:l};d=2*P(this.plotBorderWidth/2);b=wa(r(d,h[3])/2);c=wa(r(d,h[0])/2);this.clipBox={x:b,y:c,width:P(this.plotSizeX-r(d,h[1])/2-b),height:P(this.plotSizeY-r(d,h[2])/2-c)};a||n(this.axes,function(a){a.setAxisSize();a.setAxisTranslation()})},resetMargins:function(){var a=this.spacing,b=this.margin;
this.plotTop=o(b[0],a[0]);this.marginRight=o(b[1],a[1]);this.marginBottom=o(b[2],a[2]);this.plotLeft=o(b[3],a[3]);this.axisOffset=[0,0,0,0];this.clipOffset=[0,0,0,0]},drawChartBox:function(){var a=this.options.chart,b=this.renderer,c=this.chartWidth,d=this.chartHeight,e=this.chartBackground,f=this.plotBackground,g=this.plotBorder,h=this.plotBGImage,i=a.borderWidth||0,j=a.backgroundColor,k=a.plotBackgroundColor,l=a.plotBackgroundImage,m=a.plotBorderWidth||0,p,q=this.plotLeft,o=this.plotTop,n=this.plotWidth,
r=this.plotHeight,t=this.plotBox,u=this.clipRect,s=this.clipBox;p=i+(a.shadow?8:0);if(i||j)if(e)e.animate(e.crisp(null,null,null,c-p,d-p));else{e={fill:j||S};if(i)e.stroke=a.borderColor,e["stroke-width"]=i;this.chartBackground=b.rect(p/2,p/2,c-p,d-p,a.borderRadius,i).attr(e).add().shadow(a.shadow)}if(k)f?f.animate(t):this.plotBackground=b.rect(q,o,n,r,0).attr({fill:k}).add().shadow(a.plotShadow);if(l)h?h.animate(t):this.plotBGImage=b.image(l,q,o,n,r).add();u?u.animate({width:s.width,height:s.height}):
this.clipRect=b.clipRect(s);if(m)g?g.animate(g.crisp(null,q,o,n,r)):this.plotBorder=b.rect(q,o,n,r,0,-m).attr({stroke:a.plotBorderColor,"stroke-width":m,zIndex:1}).add();this.isDirtyBox=!1},propFromSeries:function(){var a=this,b=a.options.chart,c,d=a.options.series,e,f;n(["inverted","angular","polar"],function(g){c=X[b.type||b.defaultSeriesType];f=a[g]||b[g]||c&&c.prototype[g];for(e=d&&d.length;!f&&e--;)(c=X[d[e].type])&&c.prototype[g]&&(f=!0);a[g]=f})},linkSeries:function(){var a=this,b=a.series;
n(b,function(a){a.linkedSeries.length=0});n(b,function(b){var d=b.options.linkedTo;if(ea(d)&&(d=d===":previous"?a.series[b.index-1]:a.get(d)))d.linkedSeries.push(b),b.linkedParent=d})},render:function(){var a=this,b=a.axes,c=a.renderer,d=a.options,e=d.labels,f=d.credits,g;a.setTitle();a.legend=new fb(a,d.legend);a.getStacks();n(b,function(a){a.setScale()});a.getMargins();a.maxTicks=null;n(b,function(a){a.setTickPositions(!0);a.setMaxTicks()});a.adjustTickAmounts();a.getMargins();a.drawChartBox();
a.hasCartesianSeries&&n(b,function(a){a.render()});if(!a.seriesGroup)a.seriesGroup=c.g("series-group").attr({zIndex:3}).add();n(a.series,function(a){a.translate();a.setTooltipPoints();a.render()});e.items&&n(e.items,function(b){var d=s(e.style,b.style),f=y(d.left)+a.plotLeft,g=y(d.top)+a.plotTop+12;delete d.left;delete d.top;c.text(b.html,f,g).attr({zIndex:2}).css(d).add()});if(f.enabled&&!a.credits)g=f.href,a.credits=c.text(f.text,0,0).on("click",function(){if(g)location.href=g}).attr({align:f.position.align,
zIndex:8}).css(f.style).add().align(f.position);a.hasRendered=!0},destroy:function(){var a=this,b=a.axes,c=a.series,d=a.container,e,f=d&&d.parentNode;A(a,"destroy");Ga[a.index]=v;a.renderTo.removeAttribute("data-highcharts-chart");$(a);for(e=b.length;e--;)b[e]=b[e].destroy();for(e=c.length;e--;)c[e]=c[e].destroy();n("title,subtitle,chartBackground,plotBackground,plotBGImage,plotBorder,seriesGroup,clipRect,credits,pointer,scroller,rangeSelector,legend,resetZoomButton,tooltip,renderer".split(","),function(b){var c=
a[b];c&&c.destroy&&(a[b]=c.destroy())});if(d)d.innerHTML="",$(d),f&&Ta(d);for(e in a)delete a[e]},isReadyToRender:function(){var a=this;return!W&&N==N.top&&z.readyState!=="complete"||ca&&!N.canvg?(ca?Tb.push(function(){a.firstRender()},a.options.global.canvasToolsURL):z.attachEvent("onreadystatechange",function(){z.detachEvent("onreadystatechange",a.firstRender);z.readyState==="complete"&&a.firstRender()}),!1):!0},firstRender:function(){var a=this,b=a.options,c=a.callback;if(a.isReadyToRender())a.getContainer(),
A(a,"init"),a.resetMargins(),a.setChartSize(),a.propFromSeries(),a.getAxes(),n(b.series||[],function(b){a.initSeries(b)}),a.linkSeries(),A(a,"beforeRender"),a.pointer=new xb(a,b),a.render(),a.renderer.draw(),c&&c.apply(a,[a]),n(a.callbacks,function(b){b.apply(a,[a])}),a.cloneRenderTo(!0),A(a,"load")},splashArray:function(a,b){var c=b[a],c=T(c)?c:[c,c,c,c];return[o(b[a+"Top"],c[0]),o(b[a+"Right"],c[1]),o(b[a+"Bottom"],c[2]),o(b[a+"Left"],c[3])]}};yb.prototype.callbacks=[];var Pa=function(){};Pa.prototype=
{init:function(a,b,c){this.series=a;this.applyOptions(b,c);this.pointAttr={};if(a.options.colorByPoint&&(b=a.options.colors||a.chart.options.colors,this.color=this.color||b[a.colorCounter++],a.colorCounter===b.length))a.colorCounter=0;a.chart.pointCount++;return this},applyOptions:function(a,b){var c=this.series,d=c.pointValKey,a=Pa.prototype.optionsToObject.call(this,a);s(this,a);this.options=this.options?s(this.options,a):a;if(d)this.y=this[d];if(this.x===v&&c)this.x=b===v?c.autoIncrement():b;return this},
optionsToObject:function(a){var b={},c=this.series,d=c.pointArrayMap||["y"],e=d.length,f=0,g=0;if(typeof a==="number"||a===null)b[d[0]]=a;else if(Ia(a)){if(a.length>e){c=typeof a[0];if(c==="string")b.name=a[0];else if(c==="number")b.x=a[0];f++}for(;g<e;)b[d[g++]]=a[f++]}else if(typeof a==="object"){b=a;if(a.dataLabels)c._hasPointLabels=!0;if(a.marker)c._hasPointMarkers=!0}return b},destroy:function(){var a=this.series.chart,b=a.hoverPoints,c;a.pointCount--;if(b&&(this.setState(),ga(b,this),!b.length))a.hoverPoints=
null;if(this===a.hoverPoint)this.onMouseOut();if(this.graphic||this.dataLabel)$(this),this.destroyElements();this.legendItem&&a.legend.destroyItem(this);for(c in this)this[c]=null},destroyElements:function(){for(var a="graphic,dataLabel,dataLabelUpper,group,connector,shadowGroup".split(","),b,c=6;c--;)b=a[c],this[b]&&(this[b]=this[b].destroy())},getLabelConfig:function(){return{x:this.category,y:this.y,key:this.name||this.category,series:this.series,point:this,percentage:this.percentage,total:this.total||
this.stackTotal}},select:function(a,b){var c=this,d=c.series,e=d.chart,a=o(a,!c.selected);c.firePointEvent(a?"select":"unselect",{accumulate:b},function(){c.selected=c.options.selected=a;d.options.data[pa(c,d.data)]=c.options;c.setState(a&&"select");b||n(e.getSelectedPoints(),function(a){if(a.selected&&a!==c)a.selected=a.options.selected=!1,d.options.data[pa(a,d.data)]=a.options,a.setState(""),a.firePointEvent("unselect")})})},onMouseOver:function(a){var b=this.series,c=b.chart,d=c.tooltip,e=c.hoverPoint;
if(e&&e!==this)e.onMouseOut();this.firePointEvent("mouseOver");d&&(!d.shared||b.noSharedTooltip)&&d.refresh(this,a);this.setState("hover");c.hoverPoint=this},onMouseOut:function(){var a=this.series.chart,b=a.hoverPoints;if(!b||pa(this,b)===-1)this.firePointEvent("mouseOut"),this.setState(),a.hoverPoint=null},tooltipFormatter:function(a){var b=this.series,c=b.tooltipOptions,d=o(c.valueDecimals,""),e=c.valuePrefix||"",f=c.valueSuffix||"";n(b.pointArrayMap||["y"],function(b){b="{point."+b;if(e||f)a=
a.replace(b+"}",e+b+"}"+f);a=a.replace(b+"}",b+":,."+d+"f}")});return Ca(a,{point:this,series:this.series})},update:function(a,b,c){var d=this,e=d.series,f=d.graphic,g,h=e.data,i=e.chart,j=e.options,b=o(b,!0);d.firePointEvent("update",{options:a},function(){d.applyOptions(a);if(T(a)&&(e.getAttribs(),f))a&&a.marker&&a.marker.symbol?d.graphic=f.destroy():f.attr(d.pointAttr[d.state||""]);g=pa(d,h);e.xData[g]=d.x;e.yData[g]=e.toYData?e.toYData(d):d.y;e.zData[g]=d.z;j.data[g]=d.options;e.isDirty=e.isDirtyData=
!0;if(!e.fixedBox&&e.hasCartesianSeries)i.isDirtyBox=!0;j.legendType==="point"&&i.legend.destroyItem(d);b&&i.redraw(c)})},remove:function(a,b){var c=this,d=c.series,e=d.points,f=d.chart,g,h=d.data;La(b,f);a=o(a,!0);c.firePointEvent("remove",null,function(){g=pa(c,h);h.length===e.length&&e.splice(g,1);h.splice(g,1);d.options.data.splice(g,1);d.xData.splice(g,1);d.yData.splice(g,1);d.zData.splice(g,1);c.destroy();d.isDirty=!0;d.isDirtyData=!0;a&&f.redraw()})},firePointEvent:function(a,b,c){var d=this,
e=this.series.options;(e.point.events[a]||d.options&&d.options.events&&d.options.events[a])&&this.importEvents();a==="click"&&e.allowPointSelect&&(c=function(a){d.select(null,a.ctrlKey||a.metaKey||a.shiftKey)});A(this,a,b,c)},importEvents:function(){if(!this.hasImportedEvents){var a=x(this.series.options.point,this.options).events,b;this.events=a;for(b in a)K(this,b,a[b]);this.hasImportedEvents=!0}},setState:function(a){var b=this.plotX,c=this.plotY,d=this.series,e=d.options.states,f=Z[d.type].marker&&
d.options.marker,g=f&&!f.enabled,h=f&&f.states[a],i=h&&h.enabled===!1,j=d.stateMarkerGraphic,k=this.marker||{},l=d.chart,m=this.pointAttr,a=a||"";if(!(a===this.state||this.selected&&a!=="select"||e[a]&&e[a].enabled===!1||a&&(i||g&&!h.enabled)||a&&k.states&&k.states[a]&&k.states[a].enabled===!1)){if(this.graphic)e=f&&this.graphic.symbolName&&m[a].r,this.graphic.attr(x(m[a],e?{x:b-e,y:c-e,width:2*e,height:2*e}:{}));else{if(a&&h)e=h.radius,k=k.symbol||d.symbol,j&&j.currentSymbol!==k&&(j=j.destroy()),
j?j.attr({x:b-e,y:c-e}):(d.stateMarkerGraphic=j=l.renderer.symbol(k,b-e,c-e,2*e,2*e).attr(m[a]).add(d.markerGroup),j.currentSymbol=k);if(j)j[a&&l.isInsidePlot(b,c)?"show":"hide"]()}this.state=a}}};var Q=function(){};Q.prototype={isCartesian:!0,type:"line",pointClass:Pa,sorted:!0,requireSorting:!0,pointAttrToOptions:{stroke:"lineColor","stroke-width":"lineWidth",fill:"fillColor",r:"radius"},colorCounter:0,init:function(a,b){var c,d,e=a.series;this.chart=a;this.options=b=this.setOptions(b);this.linkedSeries=
[];this.bindAxes();s(this,{name:b.name,state:"",pointAttr:{},visible:b.visible!==!1,selected:b.selected===!0});if(ca)b.animation=!1;d=b.events;for(c in d)K(this,c,d[c]);if(d&&d.click||b.point&&b.point.events&&b.point.events.click||b.allowPointSelect)a.runTrackerClick=!0;this.getColor();this.getSymbol();this.setData(b.data,!1);if(this.isCartesian)a.hasCartesianSeries=!0;e.push(this);this._i=e.length-1;Kb(e,function(a,b){return o(a.options.index,a._i)-o(b.options.index,a._i)});n(e,function(a,b){a.index=
b;a.name=a.name||"Series "+(b+1)})},bindAxes:function(){var a=this,b=a.options,c=a.chart,d;a.isCartesian&&n(["xAxis","yAxis"],function(e){n(c[e],function(c){d=c.options;if(b[e]===d.index||b[e]!==v&&b[e]===d.id||b[e]===v&&d.index===0)c.series.push(a),a[e]=c,c.isDirty=!0});a[e]||ka(18,!0)})},autoIncrement:function(){var a=this.options,b=this.xIncrement,b=o(b,a.pointStart,0);this.pointInterval=o(this.pointInterval,a.pointInterval,1);this.xIncrement=b+this.pointInterval;return b},getSegments:function(){var a=
-1,b=[],c,d=this.points,e=d.length;if(e)if(this.options.connectNulls){for(c=e;c--;)d[c].y===null&&d.splice(c,1);d.length&&(b=[d])}else n(d,function(c,g){c.y===null?(g>a+1&&b.push(d.slice(a+1,g)),a=g):g===e-1&&b.push(d.slice(a+1,g+1))});this.segments=b},setOptions:function(a){var b=this.chart.options,c=b.plotOptions,d=c[this.type];this.userOptions=a;a=x(d,c.series,a);this.tooltipOptions=x(b.tooltip,a.tooltip);d.marker===null&&delete a.marker;return a},getColor:function(){var a=this.options,b=this.userOptions,
c=this.chart.options.colors,d=this.chart.counters,e;e=a.color||Z[this.type].color;if(!e&&!a.colorByPoint)u(b._colorIndex)?a=b._colorIndex:(b._colorIndex=d.color,a=d.color++),e=c[a];this.color=e;d.wrapColor(c.length)},getSymbol:function(){var a=this.userOptions,b=this.options.marker,c=this.chart,d=c.options.symbols,c=c.counters;this.symbol=b.symbol;if(!this.symbol)u(a._symbolIndex)?a=a._symbolIndex:(a._symbolIndex=c.symbol,a=c.symbol++),this.symbol=d[a];if(/^url/.test(this.symbol))b.radius=0;c.wrapSymbol(d.length)},
drawLegendSymbol:function(a){var b=this.options,c=b.marker,d=a.options,e;e=d.symbolWidth;var f=this.chart.renderer,g=this.legendGroup,a=a.baseline-t(f.fontMetrics(d.itemStyle.fontSize).b*0.3);if(b.lineWidth){d={"stroke-width":b.lineWidth};if(b.dashStyle)d.dashstyle=b.dashStyle;this.legendLine=f.path(["M",0,a,"L",e,a]).attr(d).add(g)}if(c&&c.enabled)b=c.radius,this.legendSymbol=e=f.symbol(this.symbol,e/2-b,a-b,2*b,2*b).add(g),e.isMarker=!0},addPoint:function(a,b,c,d){var e=this.options,f=this.data,
g=this.graph,h=this.area,i=this.chart,j=this.xData,k=this.yData,l=this.zData,m=this.xAxis&&this.xAxis.names,p=g&&g.shift||0,q=e.data,r;La(d,i);c&&n([g,h,this.graphNeg,this.areaNeg],function(a){if(a)a.shift=p+1});if(h)h.isArea=!0;b=o(b,!0);d={series:this};this.pointClass.prototype.applyOptions.apply(d,[a]);g=d.x;h=j.length;if(this.requireSorting&&g<j[h-1])for(r=!0;h&&j[h-1]>g;)h--;j.splice(h,0,g);k.splice(h,0,this.toYData?this.toYData(d):d.y);l.splice(h,0,d.z);if(m)m[g]=d.name;q.splice(h,0,a);r&&(this.data.splice(h,
0,null),this.processData());e.legendType==="point"&&this.generatePoints();c&&(f[0]&&f[0].remove?f[0].remove(!1):(f.shift(),j.shift(),k.shift(),l.shift(),q.shift()));this.isDirtyData=this.isDirty=!0;b&&(this.getAttribs(),i.redraw())},setData:function(a,b){var c=this.points,d=this.options,e=this.chart,f=null,g=this.xAxis,h=g&&g.names,i;this.xIncrement=null;this.pointRange=g&&g.categories?1:d.pointRange;this.colorCounter=0;var j=[],k=[],l=[],m=a?a.length:[];i=o(d.turboThreshold,1E3);var p=this.pointArrayMap,
p=p&&p.length,q=!!this.toYData;if(i&&m>i){for(i=0;f===null&&i<m;)f=a[i],i++;if(ra(f)){h=o(d.pointStart,0);d=o(d.pointInterval,1);for(i=0;i<m;i++)j[i]=h,k[i]=a[i],h+=d;this.xIncrement=h}else if(Ia(f))if(p)for(i=0;i<m;i++)d=a[i],j[i]=d[0],k[i]=d.slice(1,p+1);else for(i=0;i<m;i++)d=a[i],j[i]=d[0],k[i]=d[1];else ka(12)}else for(i=0;i<m;i++)if(a[i]!==v&&(d={series:this},this.pointClass.prototype.applyOptions.apply(d,[a[i]]),j[i]=d.x,k[i]=q?this.toYData(d):d.y,l[i]=d.z,h&&d.name))h[d.x]=d.name;ea(k[0])&&
ka(14,!0);this.data=[];this.options.data=a;this.xData=j;this.yData=k;this.zData=l;for(i=c&&c.length||0;i--;)c[i]&&c[i].destroy&&c[i].destroy();if(g)g.minRange=g.userMinRange;this.isDirty=this.isDirtyData=e.isDirtyBox=!0;o(b,!0)&&e.redraw(!1)},remove:function(a,b){var c=this,d=c.chart,a=o(a,!0);if(!c.isRemoving)c.isRemoving=!0,A(c,"remove",null,function(){c.destroy();d.isDirtyLegend=d.isDirtyBox=!0;d.linkSeries();a&&d.redraw(b)});c.isRemoving=!1},processData:function(a){var b=this.xData,c=this.yData,
d=b.length,e;e=0;var f,g,h=this.xAxis,i=this.options,j=i.cropThreshold,k=this.isCartesian;if(k&&!this.isDirty&&!h.isDirty&&!this.yAxis.isDirty&&!a)return!1;if(k&&this.sorted&&(!j||d>j||this.forceCrop))if(a=h.min,h=h.max,b[d-1]<a||b[0]>h)b=[],c=[];else if(b[0]<a||b[d-1]>h)e=this.cropData(this.xData,this.yData,a,h),b=e.xData,c=e.yData,e=e.start,f=!0;for(h=b.length-1;h>=0;h--)d=b[h]-b[h-1],d>0&&(g===v||d<g)?g=d:d<0&&this.requireSorting&&ka(15);this.cropped=f;this.cropStart=e;this.processedXData=b;this.processedYData=
c;if(i.pointRange===null)this.pointRange=g||1;this.closestPointRange=g},cropData:function(a,b,c,d){var e=a.length,f=0,g=e,h=o(this.cropShoulder,1),i;for(i=0;i<e;i++)if(a[i]>=c){f=r(0,i-h);break}for(;i<e;i++)if(a[i]>d){g=i+h;break}return{xData:a.slice(f,g),yData:b.slice(f,g),start:f,end:g}},generatePoints:function(){var a=this.options.data,b=this.data,c,d=this.processedXData,e=this.processedYData,f=this.pointClass,g=d.length,h=this.cropStart||0,i,j=this.hasGroupedData,k,l=[],m;if(!b&&!j)b=[],b.length=
a.length,b=this.data=b;for(m=0;m<g;m++)i=h+m,j?l[m]=(new f).init(this,[d[m]].concat(ja(e[m]))):(b[i]?k=b[i]:a[i]!==v&&(b[i]=k=(new f).init(this,a[i],d[m])),l[m]=k);if(b&&(g!==(c=b.length)||j))for(m=0;m<c;m++)if(m===h&&!j&&(m+=g),b[m])b[m].destroyElements(),b[m].plotX=v;this.data=b;this.points=l},setStackedPoints:function(){if(this.options.stacking&&!(this.visible!==!0&&this.chart.options.chart.ignoreHiddenSeries!==!1)){var a=this.processedXData,b=this.processedYData,c=[],d=b.length,e=this.options,
f=e.threshold,g=e.stack,e=e.stacking,h=this.stackKey,i="-"+h,j=this.negStacks,k=this.yAxis,l=k.stacks,m=k.oldStacks,p,q,o,n,t;for(o=0;o<d;o++){n=a[o];t=b[o];q=(p=j&&t<f)?i:h;l[q]||(l[q]={});if(!l[q][n])m[q]&&m[q][n]?(l[q][n]=m[q][n],l[q][n].total=null):l[q][n]=new Mb(k,k.options.stackLabels,p,n,g,e);q=l[q][n];q.points[this.index]=[q.cum||0];e==="percent"?(p=p?h:i,j&&l[p]&&l[p][n]?(p=l[p][n],q.total=p.total=r(p.total,q.total)+M(t)||0):q.total+=M(t)||0):q.total+=t||0;q.cum=(q.cum||0)+(t||0);q.points[this.index].push(q.cum);
c[o]=q.cum}if(e==="percent")k.usePercentage=!0;this.stackedYData=c;k.oldStacks={}}},setPercentStacks:function(){var a=this,b=a.stackKey,c=a.yAxis.stacks;n([b,"-"+b],function(b){var d;for(var e=a.xData.length,f,g;e--;)if(f=a.xData[e],d=(g=c[b]&&c[b][f])&&g.points[a.index],f=d)g=g.total?100/g.total:0,f[0]=ia(f[0]*g),f[1]=ia(f[1]*g),a.stackedYData[e]=f[1]})},getExtremes:function(){var a=this.yAxis,b=this.processedXData,c=this.stackedYData||this.processedYData,d=c.length,e=[],f=0,g=this.xAxis.getExtremes(),
h=g.min,g=g.max,i,j,k,l;for(l=0;l<d;l++)if(j=b[l],k=c[l],i=k!==null&&k!==v&&(!a.isLog||k.length||k>0),j=this.getExtremesFromAll||this.cropped||(b[l+1]||j)>=h&&(b[l-1]||j)<=g,i&&j)if(i=k.length)for(;i--;)k[i]!==null&&(e[f++]=k[i]);else e[f++]=k;this.dataMin=o(void 0,Ja(e));this.dataMax=o(void 0,ua(e))},translate:function(){this.processedXData||this.processData();this.generatePoints();for(var a=this.options,b=a.stacking,c=this.xAxis,d=c.categories,e=this.yAxis,f=this.points,g=f.length,h=!!this.modifyValue,
i=a.pointPlacement,j=i==="between"||ra(i),k=a.threshold,a=0;a<g;a++){var l=f[a],m=l.x,p=l.y,q=l.low,n=e.stacks[(this.negStacks&&p<k?"-":"")+this.stackKey];if(e.isLog&&p<=0)l.y=p=null;l.plotX=c.translate(m,0,0,0,1,i,this.type==="flags");if(b&&this.visible&&n&&n[m])n=n[m],p=n.points[this.index],q=p[0],p=p[1],q===0&&(q=o(k,e.min)),e.isLog&&q<=0&&(q=null),l.total=l.stackTotal=n.total,l.percentage=b==="percent"&&l.y/n.total*100,l.stackY=p,n.setOffset(this.pointXOffset||0,this.barW||0);l.yBottom=u(q)?e.translate(q,
0,1,0,1):null;h&&(p=this.modifyValue(p,l));l.plotY=typeof p==="number"&&p!==Infinity?e.translate(p,0,1,0,1):v;l.clientX=j?c.translate(m,0,0,0,1):l.plotX;l.negative=l.y<(k||0);l.category=d&&d[l.x]!==v?d[l.x]:l.x}this.getSegments()},setTooltipPoints:function(a){var b=[],c,d,e=this.xAxis,f=e&&e.getExtremes(),g=e?e.tooltipLen||e.len:this.chart.plotSizeX,h,i,j=[];if(this.options.enableMouseTracking!==!1){if(a)this.tooltipPoints=null;n(this.segments||this.points,function(a){b=b.concat(a)});e&&e.reversed&&
(b=b.reverse());this.orderTooltipPoints&&this.orderTooltipPoints(b);a=b.length;for(i=0;i<a;i++)if(e=b[i],c=e.x,c>=f.min&&c<=f.max){h=b[i+1];c=d===v?0:d+1;for(d=b[i+1]?J(r(0,P((e.clientX+(h?h.wrappedClientX||h.clientX:g))/2)),g):g;c>=0&&c<=d;)j[c++]=e}this.tooltipPoints=j}},tooltipHeaderFormatter:function(a){var b=this.tooltipOptions,c=b.xDateFormat,d=b.dateTimeLabelFormats,e=this.xAxis,f=e&&e.options.type==="datetime",b=b.headerFormat,e=e&&e.closestPointRange,g;if(f&&!c)if(e)for(g in D){if(D[g]>=
e){c=d[g];break}}else c=d.day;f&&c&&ra(a.key)&&(b=b.replace("{point.key}","{point.key:"+c+"}"));return Ca(b,{point:a,series:this})},onMouseOver:function(){var a=this.chart,b=a.hoverSeries;if(b&&b!==this)b.onMouseOut();this.options.events.mouseOver&&A(this,"mouseOver");this.setState("hover");a.hoverSeries=this},onMouseOut:function(){var a=this.options,b=this.chart,c=b.tooltip,d=b.hoverPoint;if(d)d.onMouseOut();this&&a.events.mouseOut&&A(this,"mouseOut");c&&!a.stickyTracking&&(!c.shared||this.noSharedTooltip)&&
c.hide();this.setState();b.hoverSeries=null},animate:function(a){var b=this,c=b.chart,d=c.renderer,e;e=b.options.animation;var f=c.clipBox,g=c.inverted,h;if(e&&!T(e))e=Z[b.type].animation;h="_sharedClip"+e.duration+e.easing;if(a)a=c[h],e=c[h+"m"],a||(c[h]=a=d.clipRect(s(f,{width:0})),c[h+"m"]=e=d.clipRect(-99,g?-c.plotLeft:-c.plotTop,99,g?c.chartWidth:c.chartHeight)),b.group.clip(a),b.markerGroup.clip(e),b.sharedClipKey=h;else{if(a=c[h])a.animate({width:c.plotSizeX},e),c[h+"m"].animate({width:c.plotSizeX+
99},e);b.animate=null;b.animationTimeout=setTimeout(function(){b.afterAnimate()},e.duration)}},afterAnimate:function(){var a=this.chart,b=this.sharedClipKey,c=this.group;c&&this.options.clip!==!1&&(c.clip(a.clipRect),this.markerGroup.clip());setTimeout(function(){b&&a[b]&&(a[b]=a[b].destroy(),a[b+"m"]=a[b+"m"].destroy())},100)},drawPoints:function(){var a,b=this.points,c=this.chart,d,e,f,g,h,i,j,k,l=this.options.marker,m,n=this.markerGroup;if(l.enabled||this._hasPointMarkers)for(f=b.length;f--;)if(g=
b[f],d=P(g.plotX),e=g.plotY,k=g.graphic,i=g.marker||{},a=l.enabled&&i.enabled===v||i.enabled,m=c.isInsidePlot(t(d),e,c.inverted),a&&e!==v&&!isNaN(e)&&g.y!==null)if(a=g.pointAttr[g.selected?"select":""],h=a.r,i=o(i.symbol,this.symbol),j=i.indexOf("url")===0,k)k.attr({visibility:m?W?"inherit":"visible":"hidden"}).animate(s({x:d-h,y:e-h},k.symbolName?{width:2*h,height:2*h}:{}));else{if(m&&(h>0||j))g.graphic=c.renderer.symbol(i,d-h,e-h,2*h,2*h).attr(a).add(n)}else if(k)g.graphic=k.destroy()},convertAttribs:function(a,
b,c,d){var e=this.pointAttrToOptions,f,g,h={},a=a||{},b=b||{},c=c||{},d=d||{};for(f in e)g=e[f],h[f]=o(a[g],b[f],c[f],d[f]);return h},getAttribs:function(){var a=this,b=a.options,c=Z[a.type].marker?b.marker:b,d=c.states,e=d.hover,f,g=a.color,h={stroke:g,fill:g},i=a.points||[],j=[],k,l=a.pointAttrToOptions,m=b.negativeColor,p=c.lineColor,q;b.marker?(e.radius=e.radius||c.radius+2,e.lineWidth=e.lineWidth||c.lineWidth+1):e.color=e.color||qa(e.color||g).brighten(e.brightness).get();j[""]=a.convertAttribs(c,
h);n(["hover","select"],function(b){j[b]=a.convertAttribs(d[b],j[""])});a.pointAttr=j;for(g=i.length;g--;){h=i[g];if((c=h.options&&h.options.marker||h.options)&&c.enabled===!1)c.radius=0;if(h.negative&&m)h.color=h.fillColor=m;f=b.colorByPoint||h.color;if(h.options)for(q in l)u(c[l[q]])&&(f=!0);if(f){c=c||{};k=[];d=c.states||{};f=d.hover=d.hover||{};if(!b.marker)f.color=qa(f.color||h.color).brighten(f.brightness||e.brightness).get();k[""]=a.convertAttribs(s({color:h.color,fillColor:h.color,lineColor:p===
null?h.color:v},c),j[""]);k.hover=a.convertAttribs(d.hover,j.hover,k[""]);k.select=a.convertAttribs(d.select,j.select,k[""])}else k=j;h.pointAttr=k}},update:function(a,b){var c=this.chart,d=this.type,e=X[d].prototype,f,a=x(this.userOptions,{animation:!1,index:this.index,pointStart:this.xData[0]},{data:this.options.data},a);this.remove(!1);for(f in e)e.hasOwnProperty(f)&&(this[f]=v);s(this,X[a.type||d].prototype);this.init(c,a);o(b,!0)&&c.redraw(!1)},destroy:function(){var a=this,b=a.chart,c=/AppleWebKit\/533/.test(na),
d,e,f=a.data||[],g,h,i;A(a,"destroy");$(a);n(["xAxis","yAxis"],function(b){if(i=a[b])ga(i.series,a),i.isDirty=i.forceRedraw=!0,i.stacks={}});a.legendItem&&a.chart.legend.destroyItem(a);for(e=f.length;e--;)(g=f[e])&&g.destroy&&g.destroy();a.points=null;clearTimeout(a.animationTimeout);n("area,graph,dataLabelsGroup,group,markerGroup,tracker,graphNeg,areaNeg,posClip,negClip".split(","),function(b){a[b]&&(d=c&&b==="group"?"hide":"destroy",a[b][d]())});if(b.hoverSeries===a)b.hoverSeries=null;ga(b.series,
a);for(h in a)delete a[h]},drawDataLabels:function(){var a=this,b=a.options,c=b.cursor,d=b.dataLabels,b=a.points,e,f,g,h;if(d.enabled||a._hasPointLabels)a.dlProcessOptions&&a.dlProcessOptions(d),h=a.plotGroup("dataLabelsGroup","data-labels",a.visible?"visible":"hidden",d.zIndex||6),f=d,n(b,function(b){var j,k=b.dataLabel,l,m,n=b.connector,q=!0;e=b.options&&b.options.dataLabels;j=o(e&&e.enabled,f.enabled);if(k&&!j)b.dataLabel=k.destroy();else if(j){d=x(f,e);j=d.rotation;l=b.getLabelConfig();g=d.format?
Ca(d.format,l):d.formatter.call(l,d);d.style.color=o(d.color,d.style.color,a.color,"black");if(k)if(u(g))k.attr({text:g}),q=!1;else{if(b.dataLabel=k=k.destroy(),n)b.connector=n.destroy()}else if(u(g)){k={fill:d.backgroundColor,stroke:d.borderColor,"stroke-width":d.borderWidth,r:d.borderRadius||0,rotation:j,padding:d.padding,zIndex:1};for(m in k)k[m]===v&&delete k[m];k=b.dataLabel=a.chart.renderer[j?"text":"label"](g,0,-999,null,null,null,d.useHTML).attr(k).css(s(d.style,c&&{cursor:c})).add(h).shadow(d.shadow)}k&&
a.alignDataLabel(b,k,d,null,q)}})},alignDataLabel:function(a,b,c,d,e){var f=this.chart,g=f.inverted,h=o(a.plotX,-999),i=o(a.plotY,-999),j=b.getBBox();if(a=this.visible&&f.isInsidePlot(a.plotX,a.plotY,g))d=s({x:g?f.plotWidth-i:h,y:t(g?f.plotHeight-h:i),width:0,height:0},d),s(c,{width:j.width,height:j.height}),c.rotation?(g={align:c.align,x:d.x+c.x+d.width/2,y:d.y+c.y+d.height/2},b[e?"attr":"animate"](g)):(b.align(c,null,d),g=b.alignAttr,o(c.overflow,"justify")==="justify"?this.justifyDataLabel(b,c,
g,j,d,e):o(c.crop,!0)&&(a=f.isInsidePlot(g.x,g.y)&&f.isInsidePlot(g.x+j.width,g.y+j.height)));a||b.attr({y:-999})},justifyDataLabel:function(a,b,c,d,e,f){var g=this.chart,h=b.align,i=b.verticalAlign,j,k;j=c.x;if(j<0)h==="right"?b.align="left":b.x=-j,k=!0;j=c.x+d.width;if(j>g.plotWidth)h==="left"?b.align="right":b.x=g.plotWidth-j,k=!0;j=c.y;if(j<0)i==="bottom"?b.verticalAlign="top":b.y=-j,k=!0;j=c.y+d.height;if(j>g.plotHeight)i==="top"?b.verticalAlign="bottom":b.y=g.plotHeight-j,k=!0;if(k)a.placed=
!f,a.align(b,null,e)},getSegmentPath:function(a){var b=this,c=[],d=b.options.step;n(a,function(e,f){var g=e.plotX,h=e.plotY,i;b.getPointSpline?c.push.apply(c,b.getPointSpline(a,e,f)):(c.push(f?"L":"M"),d&&f&&(i=a[f-1],d==="right"?c.push(i.plotX,h):d==="center"?c.push((i.plotX+g)/2,i.plotY,(i.plotX+g)/2,h):c.push(g,i.plotY)),c.push(e.plotX,e.plotY))});return c},getGraphPath:function(){var a=this,b=[],c,d=[];n(a.segments,function(e){c=a.getSegmentPath(e);e.length>1?b=b.concat(c):d.push(e[0])});a.singlePoints=
d;return a.graphPath=b},drawGraph:function(){var a=this,b=this.options,c=[["graph",b.lineColor||this.color]],d=b.lineWidth,e=b.dashStyle,f=b.linecap!=="square",g=this.getGraphPath(),h=b.negativeColor;h&&c.push(["graphNeg",h]);n(c,function(c,h){var k=c[0],l=a[k];if(l)Wa(l),l.animate({d:g});else if(d&&g.length)l={stroke:c[1],"stroke-width":d,zIndex:1},e?l.dashstyle=e:f&&(l["stroke-linecap"]=l["stroke-linejoin"]="round"),a[k]=a.chart.renderer.path(g).attr(l).add(a.group).shadow(!h&&b.shadow)})},clipNeg:function(){var a=
this.options,b=this.chart,c=b.renderer,d=a.negativeColor||a.negativeFillColor,e,f=this.graph,g=this.area,h=this.posClip,i=this.negClip;e=b.chartWidth;var j=b.chartHeight,k=r(e,j),l=this.yAxis;if(d&&(f||g)){d=t(l.toPixels(a.threshold||0,!0));a={x:0,y:0,width:k,height:d};k={x:0,y:d,width:k,height:k};if(b.inverted)a.height=k.y=b.plotWidth-d,c.isVML&&(a={x:b.plotWidth-d-b.plotLeft,y:0,width:e,height:j},k={x:d+b.plotLeft-e,y:0,width:b.plotLeft+d,height:e});l.reversed?(b=k,e=a):(b=a,e=k);h?(h.animate(b),
i.animate(e)):(this.posClip=h=c.clipRect(b),this.negClip=i=c.clipRect(e),f&&this.graphNeg&&(f.clip(h),this.graphNeg.clip(i)),g&&(g.clip(h),this.areaNeg.clip(i)))}},invertGroups:function(){function a(){var a={width:b.yAxis.len,height:b.xAxis.len};n(["group","markerGroup"],function(c){b[c]&&b[c].attr(a).invert()})}var b=this,c=b.chart;if(b.xAxis)K(c,"resize",a),K(b,"destroy",function(){$(c,"resize",a)}),a(),b.invertGroups=a},plotGroup:function(a,b,c,d,e){var f=this[a],g=!f;g&&(this[a]=f=this.chart.renderer.g(b).attr({visibility:c,
zIndex:d||0.1}).add(e));f[g?"attr":"animate"](this.getPlotBox());return f},getPlotBox:function(){return{translateX:this.xAxis?this.xAxis.left:this.chart.plotLeft,translateY:this.yAxis?this.yAxis.top:this.chart.plotTop,scaleX:1,scaleY:1}},render:function(){var a=this.chart,b,c=this.options,d=c.animation&&!!this.animate&&a.renderer.isSVG,e=this.visible?"visible":"hidden",f=c.zIndex,g=this.hasRendered,h=a.seriesGroup;b=this.plotGroup("group","series",e,f,h);this.markerGroup=this.plotGroup("markerGroup",
"markers",e,f,h);d&&this.animate(!0);this.getAttribs();b.inverted=this.isCartesian?a.inverted:!1;this.drawGraph&&(this.drawGraph(),this.clipNeg());this.drawDataLabels();this.drawPoints();this.options.enableMouseTracking!==!1&&this.drawTracker();a.inverted&&this.invertGroups();c.clip!==!1&&!this.sharedClipKey&&!g&&b.clip(a.clipRect);d?this.animate():g||this.afterAnimate();this.isDirty=this.isDirtyData=!1;this.hasRendered=!0},redraw:function(){var a=this.chart,b=this.isDirtyData,c=this.group,d=this.xAxis,
e=this.yAxis;c&&(a.inverted&&c.attr({width:a.plotWidth,height:a.plotHeight}),c.animate({translateX:o(d&&d.left,a.plotLeft),translateY:o(e&&e.top,a.plotTop)}));this.translate();this.setTooltipPoints(!0);this.render();b&&A(this,"updatedData")},setState:function(a){var b=this.options,c=this.graph,d=this.graphNeg,e=b.states,b=b.lineWidth,a=a||"";if(this.state!==a)this.state=a,e[a]&&e[a].enabled===!1||(a&&(b=e[a].lineWidth||b+1),c&&!c.dashstyle&&(a={"stroke-width":b},c.attr(a),d&&d.attr(a)))},setVisible:function(a,
b){var c=this,d=c.chart,e=c.legendItem,f,g=d.options.chart.ignoreHiddenSeries,h=c.visible;f=(c.visible=a=c.userOptions.visible=a===v?!h:a)?"show":"hide";n(["group","dataLabelsGroup","markerGroup","tracker"],function(a){if(c[a])c[a][f]()});if(d.hoverSeries===c)c.onMouseOut();e&&d.legend.colorizeItem(c,a);c.isDirty=!0;c.options.stacking&&n(d.series,function(a){if(a.options.stacking&&a.visible)a.isDirty=!0});n(c.linkedSeries,function(b){b.setVisible(a,!1)});if(g)d.isDirtyBox=!0;b!==!1&&d.redraw();A(c,
f)},show:function(){this.setVisible(!0)},hide:function(){this.setVisible(!1)},select:function(a){this.selected=a=a===v?!this.selected:a;if(this.checkbox)this.checkbox.checked=a;A(this,a?"select":"unselect")},drawTracker:function(){var a=this,b=a.options,c=b.trackByArea,d=[].concat(c?a.areaPath:a.graphPath),e=d.length,f=a.chart,g=f.pointer,h=f.renderer,i=f.options.tooltip.snap,j=a.tracker,k=b.cursor,l=k&&{cursor:k},k=a.singlePoints,m,p=function(){if(f.hoverSeries!==a)a.onMouseOver()};if(e&&!c)for(m=
e+1;m--;)d[m]==="M"&&d.splice(m+1,0,d[m+1]-i,d[m+2],"L"),(m&&d[m]==="M"||m===e)&&d.splice(m,0,"L",d[m-2]+i,d[m-1]);for(m=0;m<k.length;m++)e=k[m],d.push("M",e.plotX-i,e.plotY,"L",e.plotX+i,e.plotY);j?j.attr({d:d}):(a.tracker=h.path(d).attr({"stroke-linejoin":"round",visibility:a.visible?"visible":"hidden",stroke:Qb,fill:c?Qb:S,"stroke-width":b.lineWidth+(c?0:2*i),zIndex:2}).add(a.group),n([a.tracker,a.markerGroup],function(a){a.addClass("highcharts-tracker").on("mouseover",p).on("mouseout",function(a){g.onTrackerMouseOut(a)}).css(l);
if(jb)a.on("touchstart",p)}))}};G=ha(Q);X.line=G;Z.area=x(Y,{threshold:0});G=ha(Q,{type:"area",getSegments:function(){var a=[],b=[],c=[],d=this.xAxis,e=this.yAxis,f=e.stacks[this.stackKey],g={},h,i,j=this.points,k=this.options.connectNulls,l,m,p;if(this.options.stacking&&!this.cropped){for(m=0;m<j.length;m++)g[j[m].x]=j[m];for(p in f)f[p].total!==null&&c.push(+p);c.sort(function(a,b){return a-b});n(c,function(a){if(!k||g[a]&&g[a].y!==null)g[a]?b.push(g[a]):(h=d.translate(a),l=f[a].percent?f[a].total?
f[a].cum*100/f[a].total:0:f[a].cum,i=e.toPixels(l,!0),b.push({y:null,plotX:h,clientX:h,plotY:i,yBottom:i,onMouseOver:oa}))});b.length&&a.push(b)}else Q.prototype.getSegments.call(this),a=this.segments;this.segments=a},getSegmentPath:function(a){var b=Q.prototype.getSegmentPath.call(this,a),c=[].concat(b),d,e=this.options;d=b.length;var f=this.yAxis.getThreshold(e.threshold),g;d===3&&c.push("L",b[1],b[2]);if(e.stacking&&!this.closedStacks)for(d=a.length-1;d>=0;d--)g=o(a[d].yBottom,f),d<a.length-1&&
e.step&&c.push(a[d+1].plotX,g),c.push(a[d].plotX,g);else this.closeSegment(c,a,f);this.areaPath=this.areaPath.concat(c);return b},closeSegment:function(a,b,c){a.push("L",b[b.length-1].plotX,c,"L",b[0].plotX,c)},drawGraph:function(){this.areaPath=[];Q.prototype.drawGraph.apply(this);var a=this,b=this.areaPath,c=this.options,d=c.negativeColor,e=c.negativeFillColor,f=[["area",this.color,c.fillColor]];(d||e)&&f.push(["areaNeg",d,e]);n(f,function(d){var e=d[0],f=a[e];f?f.animate({d:b}):a[e]=a.chart.renderer.path(b).attr({fill:o(d[2],
qa(d[1]).setOpacity(o(c.fillOpacity,0.75)).get()),zIndex:0}).add(a.group)})},drawLegendSymbol:function(a,b){b.legendSymbol=this.chart.renderer.rect(0,a.baseline-11,a.options.symbolWidth,12,2).attr({zIndex:3}).add(b.legendGroup)}});X.area=G;Z.spline=x(Y);F=ha(Q,{type:"spline",getPointSpline:function(a,b,c){var d=b.plotX,e=b.plotY,f=a[c-1],g=a[c+1],h,i,j,k;if(f&&g){a=f.plotY;j=g.plotX;var g=g.plotY,l;h=(1.5*d+f.plotX)/2.5;i=(1.5*e+a)/2.5;j=(1.5*d+j)/2.5;k=(1.5*e+g)/2.5;l=(k-i)*(j-d)/(j-h)+e-k;i+=l;
k+=l;i>a&&i>e?(i=r(a,e),k=2*e-i):i<a&&i<e&&(i=J(a,e),k=2*e-i);k>g&&k>e?(k=r(g,e),i=2*e-k):k<g&&k<e&&(k=J(g,e),i=2*e-k);b.rightContX=j;b.rightContY=k}c?(b=["C",f.rightContX||f.plotX,f.rightContY||f.plotY,h||d,i||e,d,e],f.rightContX=f.rightContY=null):b=["M",d,e];return b}});X.spline=F;Z.areaspline=x(Z.area);la=G.prototype;F=ha(F,{type:"areaspline",closedStacks:!0,getSegmentPath:la.getSegmentPath,closeSegment:la.closeSegment,drawGraph:la.drawGraph,drawLegendSymbol:la.drawLegendSymbol});X.areaspline=
F;Z.column=x(Y,{borderColor:"#FFFFFF",borderWidth:1,borderRadius:0,groupPadding:0.2,marker:null,pointPadding:0.1,minPointLength:0,cropThreshold:50,pointRange:null,states:{hover:{brightness:0.1,shadow:!1},select:{color:"#C0C0C0",borderColor:"#000000",shadow:!1}},dataLabels:{align:null,verticalAlign:null,y:null},stickyTracking:!1,threshold:0});F=ha(Q,{type:"column",pointAttrToOptions:{stroke:"borderColor","stroke-width":"borderWidth",fill:"color",r:"borderRadius"},cropShoulder:0,trackerGroups:["group",
"dataLabelsGroup"],negStacks:!0,init:function(){Q.prototype.init.apply(this,arguments);var a=this,b=a.chart;b.hasRendered&&n(b.series,function(b){if(b.type===a.type)b.isDirty=!0})},getColumnMetrics:function(){var a=this,b=a.options,c=a.xAxis,d=a.yAxis,e=c.reversed,f,g={},h,i=0;b.grouping===!1?i=1:n(a.chart.series,function(b){var c=b.options,e=b.yAxis;if(b.type===a.type&&b.visible&&d.len===e.len&&d.pos===e.pos)c.stacking?(f=b.stackKey,g[f]===v&&(g[f]=i++),h=g[f]):c.grouping!==!1&&(h=i++),b.columnIndex=
h});var c=J(M(c.transA)*(c.ordinalSlope||b.pointRange||c.closestPointRange||1),c.len),j=c*b.groupPadding,k=(c-2*j)/i,l=b.pointWidth,b=u(l)?(k-l)/2:k*b.pointPadding,l=o(l,k-2*b);return a.columnMetrics={width:l,offset:b+(j+((e?i-(a.columnIndex||0):a.columnIndex)||0)*k-c/2)*(e?-1:1)}},translate:function(){var a=this.chart,b=this.options,c=b.borderWidth,d=this.yAxis,e=this.translatedThreshold=d.getThreshold(b.threshold),f=o(b.minPointLength,5),b=this.getColumnMetrics(),g=b.width,h=this.barW=wa(r(g,1+
2*c)),i=this.pointXOffset=b.offset,j=-(c%2?0.5:0),k=c%2?0.5:1;a.renderer.isVML&&a.inverted&&(k+=1);Q.prototype.translate.apply(this);n(this.points,function(a){var b=o(a.yBottom,e),c=J(r(-999-b,a.plotY),d.len+999+b),n=a.plotX+i,u=h,s=J(c,b),v,c=r(c,b)-s;M(c)<f&&f&&(c=f,s=t(M(s-e)>f?b-f:e-(d.translate(a.y,0,1,0,1)<=e?f:0)));a.barX=n;a.pointWidth=g;b=M(n)<0.5;u=t(n+u)+j;n=t(n)+j;u-=n;v=M(s)<0.5;c=t(s+c)+k;s=t(s)+k;c-=s;b&&(n+=1,u-=1);v&&(s-=1,c+=1);a.shapeType="rect";a.shapeArgs={x:n,y:s,width:u,height:c}})},
getSymbol:oa,drawLegendSymbol:G.prototype.drawLegendSymbol,drawGraph:oa,drawPoints:function(){var a=this,b=a.options,c=a.chart.renderer,d;n(a.points,function(e){var f=e.plotY,g=e.graphic;if(f!==v&&!isNaN(f)&&e.y!==null)d=e.shapeArgs,g?(Wa(g),g.animate(x(d))):e.graphic=c[e.shapeType](d).attr(e.pointAttr[e.selected?"select":""]).add(a.group).shadow(b.shadow,null,b.stacking&&!b.borderRadius);else if(g)e.graphic=g.destroy()})},drawTracker:function(){var a=this,b=a.chart,c=b.pointer,d=a.options.cursor,
e=d&&{cursor:d},f=function(c){var d=c.target,e;if(b.hoverSeries!==a)a.onMouseOver();for(;d&&!e;)e=d.point,d=d.parentNode;if(e!==v&&e!==b.hoverPoint)e.onMouseOver(c)};n(a.points,function(a){if(a.graphic)a.graphic.element.point=a;if(a.dataLabel)a.dataLabel.element.point=a});if(!a._hasTracking)n(a.trackerGroups,function(b){if(a[b]&&(a[b].addClass("highcharts-tracker").on("mouseover",f).on("mouseout",function(a){c.onTrackerMouseOut(a)}).css(e),jb))a[b].on("touchstart",f)}),a._hasTracking=!0},alignDataLabel:function(a,
b,c,d,e){var f=this.chart,g=f.inverted,h=a.dlBox||a.shapeArgs,i=a.below||a.plotY>o(this.translatedThreshold,f.plotSizeY),j=o(c.inside,!!this.options.stacking);if(h&&(d=x(h),g&&(d={x:f.plotWidth-d.y-d.height,y:f.plotHeight-d.x-d.width,width:d.height,height:d.width}),!j))g?(d.x+=i?0:d.width,d.width=0):(d.y+=i?d.height:0,d.height=0);c.align=o(c.align,!g||j?"center":i?"right":"left");c.verticalAlign=o(c.verticalAlign,g||j?"middle":i?"top":"bottom");Q.prototype.alignDataLabel.call(this,a,b,c,d,e)},animate:function(a){var b=
this.yAxis,c=this.options,d=this.chart.inverted,e={};if(W)a?(e.scaleY=0.001,a=J(b.pos+b.len,r(b.pos,b.toPixels(c.threshold))),d?e.translateX=a-b.len:e.translateY=a,this.group.attr(e)):(e.scaleY=1,e[d?"translateX":"translateY"]=b.pos,this.group.animate(e,this.options.animation),this.animate=null)},remove:function(){var a=this,b=a.chart;b.hasRendered&&n(b.series,function(b){if(b.type===a.type)b.isDirty=!0});Q.prototype.remove.apply(a,arguments)}});X.column=F;Z.bar=x(Z.column);la=ha(F,{type:"bar",inverted:!0});
X.bar=la;Z.scatter=x(Y,{lineWidth:0,tooltip:{headerFormat:'<span style="font-size: 10px; color:{series.color}">{series.name}</span><br/>',pointFormat:"x: <b>{point.x}</b><br/>y: <b>{point.y}</b><br/>",followPointer:!0},stickyTracking:!1});la=ha(Q,{type:"scatter",sorted:!1,requireSorting:!1,noSharedTooltip:!0,trackerGroups:["markerGroup"],takeOrdinalPosition:!1,drawTracker:F.prototype.drawTracker,setTooltipPoints:oa});X.scatter=la;Z.pie=x(Y,{borderColor:"#FFFFFF",borderWidth:1,center:[null,null],clip:!1,
colorByPoint:!0,dataLabels:{distance:30,enabled:!0,formatter:function(){return this.point.name}},ignoreHiddenPoint:!0,legendType:"point",marker:null,size:null,showInLegend:!1,slicedOffset:10,states:{hover:{brightness:0.1,shadow:!1}},stickyTracking:!1,tooltip:{followPointer:!0}});Y={type:"pie",isCartesian:!1,pointClass:ha(Pa,{init:function(){Pa.prototype.init.apply(this,arguments);var a=this,b;if(a.y<0)a.y=null;s(a,{visible:a.visible!==!1,name:o(a.name,"Slice")});b=function(b){a.slice(b.type==="select")};
K(a,"select",b);K(a,"unselect",b);return a},setVisible:function(a){var b=this,c=b.series,d=c.chart,e;b.visible=b.options.visible=a=a===v?!b.visible:a;c.options.data[pa(b,c.data)]=b.options;e=a?"show":"hide";n(["graphic","dataLabel","connector","shadowGroup"],function(a){if(b[a])b[a][e]()});b.legendItem&&d.legend.colorizeItem(b,a);if(!c.isDirty&&c.options.ignoreHiddenPoint)c.isDirty=!0,d.redraw()},slice:function(a,b,c){var d=this.series;La(c,d.chart);o(b,!0);this.sliced=this.options.sliced=a=u(a)?
a:!this.sliced;d.options.data[pa(this,d.data)]=this.options;a=a?this.slicedTranslation:{translateX:0,translateY:0};this.graphic.animate(a);this.shadowGroup&&this.shadowGroup.animate(a)}}),requireSorting:!1,noSharedTooltip:!0,trackerGroups:["group","dataLabelsGroup"],pointAttrToOptions:{stroke:"borderColor","stroke-width":"borderWidth",fill:"color"},getColor:oa,animate:function(a){var b=this,c=b.points,d=b.startAngleRad;if(!a)n(c,function(a){var c=a.graphic,a=a.shapeArgs;c&&(c.attr({r:b.center[3]/
2,start:d,end:d}),c.animate({r:a.r,start:a.start,end:a.end},b.options.animation))}),b.animate=null},setData:function(a,b){Q.prototype.setData.call(this,a,!1);this.processData();this.generatePoints();o(b,!0)&&this.chart.redraw()},generatePoints:function(){var a,b=0,c,d,e,f=this.options.ignoreHiddenPoint;Q.prototype.generatePoints.call(this);c=this.points;d=c.length;for(a=0;a<d;a++)e=c[a],b+=f&&!e.visible?0:e.y;this.total=b;for(a=0;a<d;a++)e=c[a],e.percentage=b>0?e.y/b*100:0,e.total=b},getCenter:function(){var a=
this.options,b=this.chart,c=2*(a.slicedOffset||0),d,e=b.plotWidth-2*c,f=b.plotHeight-2*c,b=a.center,a=[o(b[0],"50%"),o(b[1],"50%"),a.size||"100%",a.innerSize||0],g=J(e,f),h;return Na(a,function(a,b){h=/%$/.test(a);d=b<2||b===2&&h;return(h?[e,f,g,g][b]*y(a)/100:a)+(d?c:0)})},translate:function(a){this.generatePoints();var b=0,c=this.options,d=c.slicedOffset,e=d+c.borderWidth,f,g,h,i=c.startAngle||0,j=this.startAngleRad=xa/180*(i-90),i=(this.endAngleRad=xa/180*((c.endAngle||i+360)-90))-j,k=this.points,
l=c.dataLabels.distance,c=c.ignoreHiddenPoint,m,n=k.length,o;if(!a)this.center=a=this.getCenter();this.getX=function(b,c){h=R.asin((b-a[1])/(a[2]/2+l));return a[0]+(c?-1:1)*V(h)*(a[2]/2+l)};for(m=0;m<n;m++){o=k[m];f=j+b*i;if(!c||o.visible)b+=o.percentage/100;g=j+b*i;o.shapeType="arc";o.shapeArgs={x:a[0],y:a[1],r:a[2]/2,innerR:a[3]/2,start:t(f*1E3)/1E3,end:t(g*1E3)/1E3};h=(g+f)/2;h>0.75*i&&(h-=2*xa);o.slicedTranslation={translateX:t(V(h)*d),translateY:t(ba(h)*d)};f=V(h)*a[2]/2;g=ba(h)*a[2]/2;o.tooltipPos=
[a[0]+f*0.7,a[1]+g*0.7];o.half=h<-xa/2||h>xa/2?1:0;o.angle=h;e=J(e,l/2);o.labelPos=[a[0]+f+V(h)*l,a[1]+g+ba(h)*l,a[0]+f+V(h)*e,a[1]+g+ba(h)*e,a[0]+f,a[1]+g,l<0?"center":o.half?"right":"left",h]}},setTooltipPoints:oa,drawGraph:null,drawPoints:function(){var a=this,b=a.chart.renderer,c,d,e=a.options.shadow,f,g;if(e&&!a.shadowGroup)a.shadowGroup=b.g("shadow").add(a.group);n(a.points,function(h){d=h.graphic;g=h.shapeArgs;f=h.shadowGroup;if(e&&!f)f=h.shadowGroup=b.g("shadow").add(a.shadowGroup);c=h.sliced?
h.slicedTranslation:{translateX:0,translateY:0};f&&f.attr(c);d?d.animate(s(g,c)):h.graphic=d=b.arc(g).setRadialReference(a.center).attr(h.pointAttr[h.selected?"select":""]).attr({"stroke-linejoin":"round"}).attr(c).add(a.group).shadow(e,f);h.visible===!1&&h.setVisible(!1)})},sortByAngle:function(a,b){a.sort(function(a,d){return a.angle!==void 0&&(d.angle-a.angle)*b})},drawDataLabels:function(){var a=this,b=a.data,c,d=a.chart,e=a.options.dataLabels,f=o(e.connectorPadding,10),g=o(e.connectorWidth,1),
h=d.plotWidth,d=d.plotHeight,i,j,k=o(e.softConnector,!0),l=e.distance,m=a.center,p=m[2]/2,q=m[1],u=l>0,s,v,w,x,y=[[],[]],z,A,E,H,C,D=[0,0,0,0],J=function(a,b){return b.y-a.y};if(a.visible&&(e.enabled||a._hasPointLabels)){Q.prototype.drawDataLabels.apply(a);n(b,function(a){a.dataLabel&&y[a.half].push(a)});for(H=0;!x&&b[H];)x=b[H]&&b[H].dataLabel&&(b[H].dataLabel.getBBox().height||21),H++;for(H=2;H--;){var b=[],I=[],G=y[H],K=G.length,F;a.sortByAngle(G,H-0.5);if(l>0){for(C=q-p-l;C<=q+p+l;C+=x)b.push(C);
v=b.length;if(K>v){c=[].concat(G);c.sort(J);for(C=K;C--;)c[C].rank=C;for(C=K;C--;)G[C].rank>=v&&G.splice(C,1);K=G.length}for(C=0;C<K;C++){c=G[C];w=c.labelPos;c=9999;var N,L;for(L=0;L<v;L++)N=M(b[L]-w[1]),N<c&&(c=N,F=L);if(F<C&&b[C]!==null)F=C;else for(v<K-C+F&&b[C]!==null&&(F=v-K+C);b[F]===null;)F++;I.push({i:F,y:b[F]});b[F]=null}I.sort(J)}for(C=0;C<K;C++){c=G[C];w=c.labelPos;s=c.dataLabel;E=c.visible===!1?"hidden":"visible";c=w[1];if(l>0){if(v=I.pop(),F=v.i,A=v.y,c>A&&b[F+1]!==null||c<A&&b[F-1]!==
null)A=c}else A=c;z=e.justify?m[0]+(H?-1:1)*(p+l):a.getX(F===0||F===b.length-1?c:A,H);s._attr={visibility:E,align:w[6]};s._pos={x:z+e.x+({left:f,right:-f}[w[6]]||0),y:A+e.y-10};s.connX=z;s.connY=A;if(this.options.size===null)v=s.width,z-v<f?D[3]=r(t(v-z+f),D[3]):z+v>h-f&&(D[1]=r(t(z+v-h+f),D[1])),A-x/2<0?D[0]=r(t(-A+x/2),D[0]):A+x/2>d&&(D[2]=r(t(A+x/2-d),D[2]))}}if(ua(D)===0||this.verifyDataLabelOverflow(D))this.placeDataLabels(),u&&g&&n(this.points,function(b){i=b.connector;w=b.labelPos;if((s=b.dataLabel)&&
s._pos)E=s._attr.visibility,z=s.connX,A=s.connY,j=k?["M",z+(w[6]==="left"?5:-5),A,"C",z,A,2*w[2]-w[4],2*w[3]-w[5],w[2],w[3],"L",w[4],w[5]]:["M",z+(w[6]==="left"?5:-5),A,"L",w[2],w[3],"L",w[4],w[5]],i?(i.animate({d:j}),i.attr("visibility",E)):b.connector=i=a.chart.renderer.path(j).attr({"stroke-width":g,stroke:e.connectorColor||b.color||"#606060",visibility:E}).add(a.group);else if(i)b.connector=i.destroy()})}},verifyDataLabelOverflow:function(a){var b=this.center,c=this.options,d=c.center,e=c=c.minSize||
80,f;d[0]!==null?e=r(b[2]-r(a[1],a[3]),c):(e=r(b[2]-a[1]-a[3],c),b[0]+=(a[3]-a[1])/2);d[1]!==null?e=r(J(e,b[2]-r(a[0],a[2])),c):(e=r(J(e,b[2]-a[0]-a[2]),c),b[1]+=(a[0]-a[2])/2);e<b[2]?(b[2]=e,this.translate(b),n(this.points,function(a){if(a.dataLabel)a.dataLabel._pos=null}),this.drawDataLabels()):f=!0;return f},placeDataLabels:function(){n(this.points,function(a){var a=a.dataLabel,b;if(a)(b=a._pos)?(a.attr(a._attr),a[a.moved?"animate":"attr"](b),a.moved=!0):a&&a.attr({y:-999})})},alignDataLabel:oa,
drawTracker:F.prototype.drawTracker,drawLegendSymbol:G.prototype.drawLegendSymbol,getSymbol:oa};Y=ha(Q,Y);X.pie=Y;s(Highcharts,{Axis:eb,Chart:yb,Color:qa,Legend:fb,Pointer:xb,Point:Pa,Tick:Ma,Tooltip:wb,Renderer:Va,Series:Q,SVGElement:va,SVGRenderer:za,arrayMin:Ja,arrayMax:ua,charts:Ga,dateFormat:Ya,format:Ca,pathAnim:Ab,getOptions:function(){return L},hasBidiBug:Ub,isTouchDevice:Ob,numberFormat:Aa,seriesTypes:X,setOptions:function(a){L=x(L,a);Lb();return L},addEvent:K,removeEvent:$,createElement:U,
discardElement:Ta,css:I,each:n,extend:s,map:Na,merge:x,pick:o,splat:ja,extendClass:ha,pInt:y,wrap:mb,svg:W,canvas:ca,vml:!W&&!ca,product:"Highcharts",version:"3.0.7"})})();

define("Highcharts", ["jquery"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Highcharts;
    };
}(this)));

/*
 Highcharts JS v3.0.7 (2013-10-24)

 (c) 2009-2013 Torstein Hønsi

 License: www.highcharts.com/license
*/
(function(l,C){function J(a,b,c){this.init.call(this,a,b,c)}function K(a,b,c){a.call(this,b,c);if(this.chart.polar)this.closeSegment=function(a){var c=this.xAxis.center;a.push("L",c[0],c[1])},this.closedStacks=!0}function L(a,b){var c=this.chart,d=this.options.animation,g=this.group,f=this.markerGroup,e=this.xAxis.center,i=c.plotLeft,o=c.plotTop;if(c.polar){if(c.renderer.isSVG)if(d===!0&&(d={}),b){if(c={translateX:e[0]+i,translateY:e[1]+o,scaleX:0.001,scaleY:0.001},g.attr(c),f)f.attrSetters=g.attrSetters,
f.attr(c)}else c={translateX:i,translateY:o,scaleX:1,scaleY:1},g.animate(c,d),f&&f.animate(c,d),this.animate=null}else a.call(this,b)}var P=l.arrayMin,Q=l.arrayMax,r=l.each,F=l.extend,p=l.merge,R=l.map,q=l.pick,v=l.pInt,m=l.getOptions().plotOptions,h=l.seriesTypes,x=l.extendClass,M=l.splat,n=l.wrap,N=l.Axis,u=l.Tick,z=l.Series,t=h.column.prototype,s=Math,D=s.round,A=s.floor,S=s.max,w=function(){};F(J.prototype,{init:function(a,b,c){var d=this,g=d.defaultOptions;d.chart=b;if(b.angular)g.background=
{};d.options=a=p(g,a);(a=a.background)&&r([].concat(M(a)).reverse(),function(a){var b=a.backgroundColor,a=p(d.defaultBackgroundOptions,a);if(b)a.backgroundColor=b;a.color=a.backgroundColor;c.options.plotBands.unshift(a)})},defaultOptions:{center:["50%","50%"],size:"85%",startAngle:0},defaultBackgroundOptions:{shape:"circle",borderWidth:1,borderColor:"silver",backgroundColor:{linearGradient:{x1:0,y1:0,x2:0,y2:1},stops:[[0,"#FFF"],[1,"#DDD"]]},from:Number.MIN_VALUE,innerRadius:0,to:Number.MAX_VALUE,
outerRadius:"105%"}});var G=N.prototype,u=u.prototype,T={getOffset:w,redraw:function(){this.isDirty=!1},render:function(){this.isDirty=!1},setScale:w,setCategories:w,setTitle:w},O={isRadial:!0,defaultRadialGaugeOptions:{labels:{align:"center",x:0,y:null},minorGridLineWidth:0,minorTickInterval:"auto",minorTickLength:10,minorTickPosition:"inside",minorTickWidth:1,plotBands:[],tickLength:10,tickPosition:"inside",tickWidth:2,title:{rotation:0},zIndex:2},defaultRadialXOptions:{gridLineWidth:1,labels:{align:null,
distance:15,x:0,y:null},maxPadding:0,minPadding:0,plotBands:[],showLastLabel:!1,tickLength:0},defaultRadialYOptions:{gridLineInterpolation:"circle",labels:{align:"right",x:-3,y:-2},plotBands:[],showLastLabel:!1,title:{x:4,text:null,rotation:90}},setOptions:function(a){this.options=p(this.defaultOptions,this.defaultRadialOptions,a)},getOffset:function(){G.getOffset.call(this);this.chart.axisOffset[this.side]=0},getLinePath:function(a,b){var c=this.center,b=q(b,c[2]/2-this.offset);return this.chart.renderer.symbols.arc(this.left+
c[0],this.top+c[1],b,b,{start:this.startAngleRad,end:this.endAngleRad,open:!0,innerR:0})},setAxisTranslation:function(){G.setAxisTranslation.call(this);if(this.center&&(this.transA=this.isCircular?(this.endAngleRad-this.startAngleRad)/(this.max-this.min||1):this.center[2]/2/(this.max-this.min||1),this.isXAxis))this.minPixelPadding=this.transA*this.minPointOffset+(this.reversed?(this.endAngleRad-this.startAngleRad)/4:0)},beforeSetTickPositions:function(){this.autoConnect&&(this.max+=this.categories&&
1||this.pointRange||this.closestPointRange||0)},setAxisSize:function(){G.setAxisSize.call(this);if(this.isRadial)this.center=this.pane.center=h.pie.prototype.getCenter.call(this.pane),this.len=this.width=this.height=this.isCircular?this.center[2]*(this.endAngleRad-this.startAngleRad)/2:this.center[2]/2},getPosition:function(a,b){if(!this.isCircular)b=this.translate(a),a=this.min;return this.postTranslate(this.translate(a),q(b,this.center[2]/2)-this.offset)},postTranslate:function(a,b){var c=this.chart,
d=this.center,a=this.startAngleRad+a;return{x:c.plotLeft+d[0]+Math.cos(a)*b,y:c.plotTop+d[1]+Math.sin(a)*b}},getPlotBandPath:function(a,b,c){var d=this.center,g=this.startAngleRad,f=d[2]/2,e=[q(c.outerRadius,"100%"),c.innerRadius,q(c.thickness,10)],i=/%$/,o,k=this.isCircular;this.options.gridLineInterpolation==="polygon"?d=this.getPlotLinePath(a).concat(this.getPlotLinePath(b,!0)):(k||(e[0]=this.translate(a),e[1]=this.translate(b)),e=R(e,function(a){i.test(a)&&(a=v(a,10)*f/100);return a}),c.shape===
"circle"||!k?(a=-Math.PI/2,b=Math.PI*1.5,o=!0):(a=g+this.translate(a),b=g+this.translate(b)),d=this.chart.renderer.symbols.arc(this.left+d[0],this.top+d[1],e[0],e[0],{start:a,end:b,innerR:q(e[1],e[0]-e[2]),open:o}));return d},getPlotLinePath:function(a,b){var c=this.center,d=this.chart,g=this.getPosition(a),f,e,i;this.isCircular?i=["M",c[0]+d.plotLeft,c[1]+d.plotTop,"L",g.x,g.y]:this.options.gridLineInterpolation==="circle"?(a=this.translate(a))&&(i=this.getLinePath(0,a)):(f=d.xAxis[0],i=[],a=this.translate(a),
c=f.tickPositions,f.autoConnect&&(c=c.concat([c[0]])),b&&(c=[].concat(c).reverse()),r(c,function(c,b){e=f.getPosition(c,a);i.push(b?"L":"M",e.x,e.y)}));return i},getTitlePosition:function(){var a=this.center,b=this.chart,c=this.options.title;return{x:b.plotLeft+a[0]+(c.x||0),y:b.plotTop+a[1]-{high:0.5,middle:0.25,low:0}[c.align]*a[2]+(c.y||0)}}};n(G,"init",function(a,b,c){var j;var d=b.angular,g=b.polar,f=c.isX,e=d&&f,i,o;o=b.options;var k=c.pane||0;if(d){if(F(this,e?T:O),i=!f)this.defaultRadialOptions=
this.defaultRadialGaugeOptions}else if(g)F(this,O),this.defaultRadialOptions=(i=f)?this.defaultRadialXOptions:p(this.defaultYAxisOptions,this.defaultRadialYOptions);a.call(this,b,c);if(!e&&(d||g)){a=this.options;if(!b.panes)b.panes=[];this.pane=(j=b.panes[k]=b.panes[k]||new J(M(o.pane)[k],b,this),k=j);k=k.options;b.inverted=!1;o.chart.zoomType=null;this.startAngleRad=b=(k.startAngle-90)*Math.PI/180;this.endAngleRad=o=(q(k.endAngle,k.startAngle+360)-90)*Math.PI/180;this.offset=a.offset||0;if((this.isCircular=
i)&&c.max===C&&o-b===2*Math.PI)this.autoConnect=!0}});n(u,"getPosition",function(a,b,c,d,g){var f=this.axis;return f.getPosition?f.getPosition(c):a.call(this,b,c,d,g)});n(u,"getLabelPosition",function(a,b,c,d,g,f,e,i,o){var k=this.axis,j=f.y,h=f.align,l=(k.translate(this.pos)+k.startAngleRad+Math.PI/2)/Math.PI*180%360;k.isRadial?(a=k.getPosition(this.pos,k.center[2]/2+q(f.distance,-25)),f.rotation==="auto"?d.attr({rotation:l}):j===null&&(j=v(d.styles.lineHeight)*0.9-d.getBBox().height/2),h===null&&
(h=k.isCircular?l>20&&l<160?"left":l>200&&l<340?"right":"center":"center",d.attr({align:h})),a.x+=f.x,a.y+=j):a=a.call(this,b,c,d,g,f,e,i,o);return a});n(u,"getMarkPath",function(a,b,c,d,g,f,e){var i=this.axis;i.isRadial?(a=i.getPosition(this.pos,i.center[2]/2+d),b=["M",b,c,"L",a.x,a.y]):b=a.call(this,b,c,d,g,f,e);return b});m.arearange=p(m.area,{lineWidth:1,marker:null,threshold:null,tooltip:{pointFormat:'<span style="color:{series.color}">{series.name}</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>'},
trackByArea:!0,dataLabels:{verticalAlign:null,xLow:0,xHigh:0,yLow:0,yHigh:0}});h.arearange=l.extendClass(h.area,{type:"arearange",pointArrayMap:["low","high"],toYData:function(a){return[a.low,a.high]},pointValKey:"low",getSegments:function(){var a=this;r(a.points,function(b){if(!a.options.connectNulls&&(b.low===null||b.high===null))b.y=null;else if(b.low===null&&b.high!==null)b.y=b.high});z.prototype.getSegments.call(this)},translate:function(){var a=this.yAxis;h.area.prototype.translate.apply(this);
r(this.points,function(b){var c=b.low,d=b.high,g=b.plotY;d===null&&c===null?b.y=null:c===null?(b.plotLow=b.plotY=null,b.plotHigh=a.translate(d,0,1,0,1)):d===null?(b.plotLow=g,b.plotHigh=null):(b.plotLow=g,b.plotHigh=a.translate(d,0,1,0,1))})},getSegmentPath:function(a){var b,c=[],d=a.length,g=z.prototype.getSegmentPath,f,e;e=this.options;var i=e.step;for(b=HighchartsAdapter.grep(a,function(a){return a.plotLow!==null});d--;)f=a[d],f.plotHigh!==null&&c.push({plotX:f.plotX,plotY:f.plotHigh});a=g.call(this,
b);if(i)i===!0&&(i="left"),e.step={left:"right",center:"center",right:"left"}[i];c=g.call(this,c);e.step=i;e=[].concat(a,c);c[0]="L";this.areaPath=this.areaPath.concat(a,c);return e},drawDataLabels:function(){var a=this.data,b=a.length,c,d=[],g=z.prototype,f=this.options.dataLabels,e,i=this.chart.inverted;if(f.enabled||this._hasPointLabels){for(c=b;c--;)e=a[c],e.y=e.high,e.plotY=e.plotHigh,d[c]=e.dataLabel,e.dataLabel=e.dataLabelUpper,e.below=!1,i?(f.align="left",f.x=f.xHigh):f.y=f.yHigh;g.drawDataLabels.apply(this,
arguments);for(c=b;c--;)e=a[c],e.dataLabelUpper=e.dataLabel,e.dataLabel=d[c],e.y=e.low,e.plotY=e.plotLow,e.below=!0,i?(f.align="right",f.x=f.xLow):f.y=f.yLow;g.drawDataLabels.apply(this,arguments)}},alignDataLabel:h.column.prototype.alignDataLabel,getSymbol:h.column.prototype.getSymbol,drawPoints:w});m.areasplinerange=p(m.arearange);h.areasplinerange=x(h.arearange,{type:"areasplinerange",getPointSpline:h.spline.prototype.getPointSpline});m.columnrange=p(m.column,m.arearange,{lineWidth:1,pointRange:null});
h.columnrange=x(h.arearange,{type:"columnrange",translate:function(){var a=this,b=a.yAxis,c;t.translate.apply(a);r(a.points,function(d){var g=d.shapeArgs,f=a.options.minPointLength,e;d.plotHigh=c=b.translate(d.high,0,1,0,1);d.plotLow=d.plotY;e=c;d=d.plotY-c;d<f&&(f-=d,d+=f,e-=f/2);g.height=d;g.y=e})},trackerGroups:["group","dataLabels"],drawGraph:w,pointAttrToOptions:t.pointAttrToOptions,drawPoints:t.drawPoints,drawTracker:t.drawTracker,animate:t.animate,getColumnMetrics:t.getColumnMetrics});m.gauge=
p(m.line,{dataLabels:{enabled:!0,y:15,borderWidth:1,borderColor:"silver",borderRadius:3,style:{fontWeight:"bold"},verticalAlign:"top",zIndex:2},dial:{},pivot:{},tooltip:{headerFormat:""},showInLegend:!1});u={type:"gauge",pointClass:l.extendClass(l.Point,{setState:function(a){this.state=a}}),angular:!0,drawGraph:w,fixedBox:!0,trackerGroups:["group","dataLabels"],translate:function(){var a=this.yAxis,b=this.options,c=a.center;this.generatePoints();r(this.points,function(d){var g=p(b.dial,d.dial),f=
v(q(g.radius,80))*c[2]/200,e=v(q(g.baseLength,70))*f/100,i=v(q(g.rearLength,10))*f/100,o=g.baseWidth||3,k=g.topWidth||1,j=a.startAngleRad+a.translate(d.y,null,null,null,!0);b.wrap===!1&&(j=Math.max(a.startAngleRad,Math.min(a.endAngleRad,j)));j=j*180/Math.PI;d.shapeType="path";d.shapeArgs={d:g.path||["M",-i,-o/2,"L",e,-o/2,f,-k/2,f,k/2,e,o/2,-i,o/2,"z"],translateX:c[0],translateY:c[1],rotation:j};d.plotX=c[0];d.plotY=c[1]})},drawPoints:function(){var a=this,b=a.yAxis.center,c=a.pivot,d=a.options,g=
d.pivot,f=a.chart.renderer;r(a.points,function(c){var b=c.graphic,g=c.shapeArgs,k=g.d,j=p(d.dial,c.dial);b?(b.animate(g),g.d=k):c.graphic=f[c.shapeType](g).attr({stroke:j.borderColor||"none","stroke-width":j.borderWidth||0,fill:j.backgroundColor||"black",rotation:g.rotation}).add(a.group)});c?c.animate({translateX:b[0],translateY:b[1]}):a.pivot=f.circle(0,0,q(g.radius,5)).attr({"stroke-width":g.borderWidth||0,stroke:g.borderColor||"silver",fill:g.backgroundColor||"black"}).translate(b[0],b[1]).add(a.group)},
animate:function(a){var b=this;if(!a)r(b.points,function(a){var d=a.graphic;d&&(d.attr({rotation:b.yAxis.startAngleRad*180/Math.PI}),d.animate({rotation:a.shapeArgs.rotation},b.options.animation))}),b.animate=null},render:function(){this.group=this.plotGroup("group","series",this.visible?"visible":"hidden",this.options.zIndex,this.chart.seriesGroup);h.pie.prototype.render.call(this);this.group.clip(this.chart.clipRect)},setData:h.pie.prototype.setData,drawTracker:h.column.prototype.drawTracker};h.gauge=
l.extendClass(h.line,u);m.boxplot=p(m.column,{fillColor:"#FFFFFF",lineWidth:1,medianWidth:2,states:{hover:{brightness:-0.3}},threshold:null,tooltip:{pointFormat:'<span style="color:{series.color};font-weight:bold">{series.name}</span><br/>Maximum: {point.high}<br/>Upper quartile: {point.q3}<br/>Median: {point.median}<br/>Lower quartile: {point.q1}<br/>Minimum: {point.low}<br/>'},whiskerLength:"50%",whiskerWidth:2});h.boxplot=x(h.column,{type:"boxplot",pointArrayMap:["low","q1","median","q3","high"],
toYData:function(a){return[a.low,a.q1,a.median,a.q3,a.high]},pointValKey:"high",pointAttrToOptions:{fill:"fillColor",stroke:"color","stroke-width":"lineWidth"},drawDataLabels:w,translate:function(){var a=this.yAxis,b=this.pointArrayMap;h.column.prototype.translate.apply(this);r(this.points,function(c){r(b,function(b){c[b]!==null&&(c[b+"Plot"]=a.translate(c[b],0,1,0,1))})})},drawPoints:function(){var a=this,b=a.points,c=a.options,d=a.chart.renderer,g,f,e,i,o,k,j,h,l,m,n,H,p,E,I,t,w,s,v,u,z,y,x=a.doQuartiles!==
!1,B=parseInt(a.options.whiskerLength,10)/100;r(b,function(b){l=b.graphic;z=b.shapeArgs;n={};E={};t={};y=b.color||a.color;if(b.plotY!==C)if(g=b.pointAttr[b.selected?"selected":""],w=z.width,s=A(z.x),v=s+w,u=D(w/2),f=A(x?b.q1Plot:b.lowPlot),e=A(x?b.q3Plot:b.lowPlot),i=A(b.highPlot),o=A(b.lowPlot),n.stroke=b.stemColor||c.stemColor||y,n["stroke-width"]=q(b.stemWidth,c.stemWidth,c.lineWidth),n.dashstyle=b.stemDashStyle||c.stemDashStyle,E.stroke=b.whiskerColor||c.whiskerColor||y,E["stroke-width"]=q(b.whiskerWidth,
c.whiskerWidth,c.lineWidth),t.stroke=b.medianColor||c.medianColor||y,t["stroke-width"]=q(b.medianWidth,c.medianWidth,c.lineWidth),t["stroke-linecap"]="round",j=n["stroke-width"]%2/2,h=s+u+j,m=["M",h,e,"L",h,i,"M",h,f,"L",h,o,"z"],x&&(j=g["stroke-width"]%2/2,h=A(h)+j,f=A(f)+j,e=A(e)+j,s+=j,v+=j,H=["M",s,e,"L",s,f,"L",v,f,"L",v,e,"L",s,e,"z"]),B&&(j=E["stroke-width"]%2/2,i+=j,o+=j,p=["M",h-u*B,i,"L",h+u*B,i,"M",h-u*B,o,"L",h+u*B,o]),j=t["stroke-width"]%2/2,k=D(b.medianPlot)+j,I=["M",s,k,"L",v,k,"z"],
l)b.stem.animate({d:m}),B&&b.whiskers.animate({d:p}),x&&b.box.animate({d:H}),b.medianShape.animate({d:I});else{b.graphic=l=d.g().add(a.group);b.stem=d.path(m).attr(n).add(l);if(B)b.whiskers=d.path(p).attr(E).add(l);if(x)b.box=d.path(H).attr(g).add(l);b.medianShape=d.path(I).attr(t).add(l)}})}});m.errorbar=p(m.boxplot,{color:"#000000",grouping:!1,linkedTo:":previous",tooltip:{pointFormat:m.arearange.tooltip.pointFormat},whiskerWidth:null});h.errorbar=x(h.boxplot,{type:"errorbar",pointArrayMap:["low",
"high"],toYData:function(a){return[a.low,a.high]},pointValKey:"high",doQuartiles:!1,getColumnMetrics:function(){return this.linkedParent&&this.linkedParent.columnMetrics||h.column.prototype.getColumnMetrics.call(this)}});m.waterfall=p(m.column,{lineWidth:1,lineColor:"#333",dashStyle:"dot",borderColor:"#333"});h.waterfall=x(h.column,{type:"waterfall",upColorProp:"fill",pointArrayMap:["low","y"],pointValKey:"y",init:function(a,b){b.stacking=!0;h.column.prototype.init.call(this,a,b)},translate:function(){var a=
this.options,b=this.yAxis,c,d,g,f,e,i,o,k,j;c=a.threshold;a=a.borderWidth%2/2;h.column.prototype.translate.apply(this);k=c;g=this.points;for(d=0,c=g.length;d<c;d++){f=g[d];e=f.shapeArgs;i=this.getStack(d);j=i.points[this.index];if(isNaN(f.y))f.y=this.yData[d];o=S(k,k+f.y)+j[0];e.y=b.translate(o,0,1);f.isSum||f.isIntermediateSum?(e.y=b.translate(j[1],0,1),e.height=b.translate(j[0],0,1)-e.y):k+=i.total;e.height<0&&(e.y+=e.height,e.height*=-1);f.plotY=e.y=D(e.y)-a;e.height=D(e.height);f.yBottom=e.y+
e.height}},processData:function(a){var b=this.yData,c=this.points,d,g=b.length,f=this.options.threshold||0,e,i,h,k,j,l;i=e=h=k=f;for(l=0;l<g;l++)j=b[l],d=c&&c[l]?c[l]:{},j==="sum"||d.isSum?b[l]=i:j==="intermediateSum"||d.isIntermediateSum?(b[l]=e,e=f):(i+=j,e+=j),h=Math.min(i,h),k=Math.max(i,k);z.prototype.processData.call(this,a);this.dataMin=h;this.dataMax=k},toYData:function(a){if(a.isSum)return"sum";else if(a.isIntermediateSum)return"intermediateSum";return a.y},getAttribs:function(){h.column.prototype.getAttribs.apply(this,
arguments);var a=this.options,b=a.states,c=a.upColor||this.color,a=l.Color(c).brighten(0.1).get(),d=p(this.pointAttr),g=this.upColorProp;d[""][g]=c;d.hover[g]=b.hover.upColor||a;d.select[g]=b.select.upColor||c;r(this.points,function(a){if(a.y>0&&!a.color)a.pointAttr=d,a.color=c})},getGraphPath:function(){var a=this.data,b=a.length,c=D(this.options.lineWidth+this.options.borderWidth)%2/2,d=[],g,f,e;for(e=1;e<b;e++)f=a[e].shapeArgs,g=a[e-1].shapeArgs,f=["M",g.x+g.width,g.y+c,"L",f.x,g.y+c],a[e-1].y<
0&&(f[2]+=g.height,f[5]+=g.height),d=d.concat(f);return d},getExtremes:w,getStack:function(a){var b=this.yAxis.stacks,c=this.stackKey;this.processedYData[a]<this.options.threshold&&(c="-"+c);return b[c][a]},drawGraph:z.prototype.drawGraph});m.bubble=p(m.scatter,{dataLabels:{inside:!0,style:{color:"white",textShadow:"0px 0px 3px black"},verticalAlign:"middle"},marker:{lineColor:null,lineWidth:1},minSize:8,maxSize:"20%",tooltip:{pointFormat:"({point.x}, {point.y}), Size: {point.z}"},turboThreshold:0,
zThreshold:0});h.bubble=x(h.scatter,{type:"bubble",pointArrayMap:["y","z"],trackerGroups:["group","dataLabelsGroup"],bubblePadding:!0,pointAttrToOptions:{stroke:"lineColor","stroke-width":"lineWidth",fill:"fillColor"},applyOpacity:function(a){var b=this.options.marker,c=q(b.fillOpacity,0.5),a=a||b.fillColor||this.color;c!==1&&(a=l.Color(a).setOpacity(c).get("rgba"));return a},convertAttribs:function(){var a=z.prototype.convertAttribs.apply(this,arguments);a.fill=this.applyOpacity(a.fill);return a},
getRadii:function(a,b,c,d){var g,f,e,i=this.zData,h=[],k=this.options.sizeBy!=="width";for(f=0,g=i.length;f<g;f++)e=b-a,e=e>0?(i[f]-a)/(b-a):0.5,k&&(e=Math.sqrt(e)),h.push(s.ceil(c+e*(d-c))/2);this.radii=h},animate:function(a){var b=this.options.animation;if(!a)r(this.points,function(a){var d=a.graphic,a=a.shapeArgs;d&&a&&(d.attr("r",1),d.animate({r:a.r},b))}),this.animate=null},translate:function(){var a,b=this.data,c,d,g=this.radii;h.scatter.prototype.translate.call(this);for(a=b.length;a--;)c=
b[a],d=g?g[a]:0,c.negative=c.z<(this.options.zThreshold||0),d>=this.minPxSize/2?(c.shapeType="circle",c.shapeArgs={x:c.plotX,y:c.plotY,r:d},c.dlBox={x:c.plotX-d,y:c.plotY-d,width:2*d,height:2*d}):c.shapeArgs=c.plotY=c.dlBox=C},drawLegendSymbol:function(a,b){var c=v(a.itemStyle.fontSize)/2;b.legendSymbol=this.chart.renderer.circle(c,a.baseline-c,c).attr({zIndex:3}).add(b.legendGroup);b.legendSymbol.isMarker=!0},drawPoints:h.column.prototype.drawPoints,alignDataLabel:h.column.prototype.alignDataLabel});
N.prototype.beforePadding=function(){var a=this,b=this.len,c=this.chart,d=0,g=b,f=this.isXAxis,e=f?"xData":"yData",i=this.min,h={},k=s.min(c.plotWidth,c.plotHeight),j=Number.MAX_VALUE,l=-Number.MAX_VALUE,m=this.max-i,n=b/m,p=[];this.tickPositions&&(r(this.series,function(b){var c=b.options;if(b.bubblePadding&&b.visible&&(a.allowZoomOutside=!0,p.push(b),f))r(["minSize","maxSize"],function(a){var b=c[a],d=/%$/.test(b),b=v(b);h[a]=d?k*b/100:b}),b.minPxSize=h.minSize,b=b.zData,b.length&&(j=s.min(j,s.max(P(b),
c.displayNegative===!1?c.zThreshold:-Number.MAX_VALUE)),l=s.max(l,Q(b)))}),r(p,function(a){var b=a[e],c=b.length,k;f&&a.getRadii(j,l,h.minSize,h.maxSize);if(m>0)for(;c--;)b[c]!==null&&(k=a.radii[c],d=Math.min((b[c]-i)*n-k,d),g=Math.max((b[c]-i)*n+k,g))}),p.length&&m>0&&q(this.options.min,this.userMin)===C&&q(this.options.max,this.userMax)===C&&(g-=b,n*=(b+d-g)/b,this.min+=d/n,this.max+=g/n))};var y=z.prototype,m=l.Pointer.prototype;y.toXY=function(a){var b,c=this.chart;b=a.plotX;var d=a.plotY;a.rectPlotX=
b;a.rectPlotY=d;a.clientX=(b/Math.PI*180+this.xAxis.pane.options.startAngle)%360;b=this.xAxis.postTranslate(a.plotX,this.yAxis.len-d);a.plotX=a.polarPlotX=b.x-c.plotLeft;a.plotY=a.polarPlotY=b.y-c.plotTop};y.orderTooltipPoints=function(a){if(this.chart.polar&&(a.sort(function(a,c){return a.clientX-c.clientX}),a[0]))a[0].wrappedClientX=a[0].clientX+360,a.push(a[0])};n(h.area.prototype,"init",K);n(h.areaspline.prototype,"init",K);n(h.spline.prototype,"getPointSpline",function(a,b,c,d){var g,f,e,i,h,
k,j;if(this.chart.polar){g=c.plotX;f=c.plotY;a=b[d-1];e=b[d+1];this.connectEnds&&(a||(a=b[b.length-2]),e||(e=b[1]));if(a&&e)i=a.plotX,h=a.plotY,b=e.plotX,k=e.plotY,i=(1.5*g+i)/2.5,h=(1.5*f+h)/2.5,e=(1.5*g+b)/2.5,j=(1.5*f+k)/2.5,b=Math.sqrt(Math.pow(i-g,2)+Math.pow(h-f,2)),k=Math.sqrt(Math.pow(e-g,2)+Math.pow(j-f,2)),i=Math.atan2(h-f,i-g),h=Math.atan2(j-f,e-g),j=Math.PI/2+(i+h)/2,Math.abs(i-j)>Math.PI/2&&(j-=Math.PI),i=g+Math.cos(j)*b,h=f+Math.sin(j)*b,e=g+Math.cos(Math.PI+j)*k,j=f+Math.sin(Math.PI+
j)*k,c.rightContX=e,c.rightContY=j;d?(c=["C",a.rightContX||a.plotX,a.rightContY||a.plotY,i||g,h||f,g,f],a.rightContX=a.rightContY=null):c=["M",g,f]}else c=a.call(this,b,c,d);return c});n(y,"translate",function(a){a.call(this);if(this.chart.polar&&!this.preventPostTranslate)for(var a=this.points,b=a.length;b--;)this.toXY(a[b])});n(y,"getSegmentPath",function(a,b){var c=this.points;if(this.chart.polar&&this.options.connectEnds!==!1&&b[b.length-1]===c[c.length-1]&&c[0].y!==null)this.connectEnds=!0,b=
[].concat(b,[c[0]]);return a.call(this,b)});n(y,"animate",L);n(t,"animate",L);n(y,"setTooltipPoints",function(a,b){this.chart.polar&&F(this.xAxis,{tooltipLen:360});return a.call(this,b)});n(t,"translate",function(a){var b=this.xAxis,c=this.yAxis.len,d=b.center,g=b.startAngleRad,f=this.chart.renderer,e,h;this.preventPostTranslate=!0;a.call(this);if(b.isRadial){b=this.points;for(h=b.length;h--;)e=b[h],a=e.barX+g,e.shapeType="path",e.shapeArgs={d:f.symbols.arc(d[0],d[1],c-e.plotY,null,{start:a,end:a+
e.pointWidth,innerR:c-q(e.yBottom,c)})},this.toXY(e)}});n(t,"alignDataLabel",function(a,b,c,d,g,f){if(this.chart.polar){a=b.rectPlotX/Math.PI*180;if(d.align===null)d.align=a>20&&a<160?"left":a>200&&a<340?"right":"center";if(d.verticalAlign===null)d.verticalAlign=a<45||a>315?"bottom":a>135&&a<225?"top":"middle";y.alignDataLabel.call(this,b,c,d,g,f)}else a.call(this,b,c,d,g,f)});n(m,"getIndex",function(a,b){var c,d=this.chart,g;d.polar?(g=d.xAxis[0].center,c=b.chartX-g[0]-d.plotLeft,d=b.chartY-g[1]-
d.plotTop,c=180-Math.round(Math.atan2(c,d)/Math.PI*180)):c=a.call(this,b);return c});n(m,"getCoordinates",function(a,b){var c=this.chart,d={xAxis:[],yAxis:[]};c.polar?r(c.axes,function(a){var f=a.isXAxis,e=a.center,h=b.chartX-e[0]-c.plotLeft,e=b.chartY-e[1]-c.plotTop;d[f?"xAxis":"yAxis"].push({axis:a,value:a.translate(f?Math.PI-Math.atan2(h,e):Math.sqrt(Math.pow(h,2)+Math.pow(e,2)),!0)})}):d=a.call(this,b);return d})})(Highcharts);

define("HighchartsMore", ["Highcharts"], function(){});
