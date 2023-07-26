(function () {
  'use strict';

  class AbstractView {
    constructor() {
      this.app = document.getElementById('root');
    }

    setTitle(title) {
      document.title = title;
    }

    render() {
      return;
    }

    destroy() {
      return;
    }
  }

  const PATH_SEPARATOR = '.';
  const TARGET = Symbol('target');
  const UNSUBSCRIBE = Symbol('unsubscribe');

  function isBuiltinWithMutableMethods(value) {
  	return value instanceof Date
  		|| value instanceof Set
  		|| value instanceof Map
  		|| value instanceof WeakSet
  		|| value instanceof WeakMap
  		|| ArrayBuffer.isView(value);
  }

  function isBuiltinWithoutMutableMethods(value) {
  	return (typeof value === 'object' ? value === null : typeof value !== 'function') || value instanceof RegExp;
  }

  var isArray = Array.isArray;

  function isSymbol(value) {
  	return typeof value === 'symbol';
  }

  const path = {
  	after: (path, subPath) => {
  		if (isArray(path)) {
  			return path.slice(subPath.length);
  		}

  		if (subPath === '') {
  			return path;
  		}

  		return path.slice(subPath.length + 1);
  	},
  	concat: (path, key) => {
  		if (isArray(path)) {
  			path = [...path];

  			if (key) {
  				path.push(key);
  			}

  			return path;
  		}

  		if (key && key.toString !== undefined) {
  			if (path !== '') {
  				path += PATH_SEPARATOR;
  			}

  			if (isSymbol(key)) {
  				return path + key.toString();
  			}

  			return path + key;
  		}

  		return path;
  	},
  	initial: path => {
  		if (isArray(path)) {
  			return path.slice(0, -1);
  		}

  		if (path === '') {
  			return path;
  		}

  		const index = path.lastIndexOf(PATH_SEPARATOR);

  		if (index === -1) {
  			return '';
  		}

  		return path.slice(0, index);
  	},
  	last: path => {
  		if (isArray(path)) {
  			return path[path.length - 1] || '';
  		}

  		if (path === '') {
  			return path;
  		}

  		const index = path.lastIndexOf(PATH_SEPARATOR);

  		if (index === -1) {
  			return path;
  		}

  		return path.slice(index + 1);
  	},
  	walk: (path, callback) => {
  		if (isArray(path)) {
  			for (const key of path) {
  				callback(key);
  			}
  		} else if (path !== '') {
  			let position = 0;
  			let index = path.indexOf(PATH_SEPARATOR);

  			if (index === -1) {
  				callback(path);
  			} else {
  				while (position < path.length) {
  					if (index === -1) {
  						index = path.length;
  					}

  					callback(path.slice(position, index));

  					position = index + 1;
  					index = path.indexOf(PATH_SEPARATOR, position);
  				}
  			}
  		}
  	},
  	get(object, path) {
  		this.walk(path, key => {
  			if (object) {
  				object = object[key];
  			}
  		});

  		return object;
  	},
  };

  function isIterator(value) {
  	return typeof value === 'object' && typeof value.next === 'function';
  }

  // eslint-disable-next-line max-params
  function wrapIterator(iterator, target, thisArg, applyPath, prepareValue) {
  	const originalNext = iterator.next;

  	if (target.name === 'entries') {
  		iterator.next = function () {
  			const result = originalNext.call(this);

  			if (result.done === false) {
  				result.value[0] = prepareValue(
  					result.value[0],
  					target,
  					result.value[0],
  					applyPath,
  				);
  				result.value[1] = prepareValue(
  					result.value[1],
  					target,
  					result.value[0],
  					applyPath,
  				);
  			}

  			return result;
  		};
  	} else if (target.name === 'values') {
  		const keyIterator = thisArg[TARGET].keys();

  		iterator.next = function () {
  			const result = originalNext.call(this);

  			if (result.done === false) {
  				result.value = prepareValue(
  					result.value,
  					target,
  					keyIterator.next().value,
  					applyPath,
  				);
  			}

  			return result;
  		};
  	} else {
  		iterator.next = function () {
  			const result = originalNext.call(this);

  			if (result.done === false) {
  				result.value = prepareValue(
  					result.value,
  					target,
  					result.value,
  					applyPath,
  				);
  			}

  			return result;
  		};
  	}

  	return iterator;
  }

  function ignoreProperty(cache, options, property) {
  	return cache.isUnsubscribed
  		|| (options.ignoreSymbols && isSymbol(property))
  		|| (options.ignoreUnderscores && property.charAt(0) === '_')
  		|| ('ignoreKeys' in options && options.ignoreKeys.includes(property));
  }

  /**
  @class Cache
  @private
  */
  class Cache {
  	constructor(equals) {
  		this._equals = equals;
  		this._proxyCache = new WeakMap();
  		this._pathCache = new WeakMap();
  		this.isUnsubscribed = false;
  	}

  	_getDescriptorCache() {
  		if (this._descriptorCache === undefined) {
  			this._descriptorCache = new WeakMap();
  		}

  		return this._descriptorCache;
  	}

  	_getProperties(target) {
  		const descriptorCache = this._getDescriptorCache();
  		let properties = descriptorCache.get(target);

  		if (properties === undefined) {
  			properties = {};
  			descriptorCache.set(target, properties);
  		}

  		return properties;
  	}

  	_getOwnPropertyDescriptor(target, property) {
  		if (this.isUnsubscribed) {
  			return Reflect.getOwnPropertyDescriptor(target, property);
  		}

  		const properties = this._getProperties(target);
  		let descriptor = properties[property];

  		if (descriptor === undefined) {
  			descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  			properties[property] = descriptor;
  		}

  		return descriptor;
  	}

  	getProxy(target, path, handler, proxyTarget) {
  		if (this.isUnsubscribed) {
  			return target;
  		}

  		const reflectTarget = target[proxyTarget];
  		const source = reflectTarget || target;

  		this._pathCache.set(source, path);

  		let proxy = this._proxyCache.get(source);

  		if (proxy === undefined) {
  			proxy = reflectTarget === undefined
  				? new Proxy(target, handler)
  				: target;

  			this._proxyCache.set(source, proxy);
  		}

  		return proxy;
  	}

  	getPath(target) {
  		return this.isUnsubscribed ? undefined : this._pathCache.get(target);
  	}

  	isDetached(target, object) {
  		return !Object.is(target, path.get(object, this.getPath(target)));
  	}

  	defineProperty(target, property, descriptor) {
  		if (!Reflect.defineProperty(target, property, descriptor)) {
  			return false;
  		}

  		if (!this.isUnsubscribed) {
  			this._getProperties(target)[property] = descriptor;
  		}

  		return true;
  	}

  	setProperty(target, property, value, receiver, previous) { // eslint-disable-line max-params
  		if (!this._equals(previous, value) || !(property in target)) {
  			const descriptor = this._getOwnPropertyDescriptor(target, property);

  			if (descriptor !== undefined && 'set' in descriptor) {
  				return Reflect.set(target, property, value, receiver);
  			}

  			return Reflect.set(target, property, value);
  		}

  		return true;
  	}

  	deleteProperty(target, property, previous) {
  		if (Reflect.deleteProperty(target, property)) {
  			if (!this.isUnsubscribed) {
  				const properties = this._getDescriptorCache().get(target);

  				if (properties) {
  					delete properties[property];
  					this._pathCache.delete(previous);
  				}
  			}

  			return true;
  		}

  		return false;
  	}

  	isSameDescriptor(a, target, property) {
  		const b = this._getOwnPropertyDescriptor(target, property);

  		return a !== undefined
  			&& b !== undefined
  			&& Object.is(a.value, b.value)
  			&& (a.writable || false) === (b.writable || false)
  			&& (a.enumerable || false) === (b.enumerable || false)
  			&& (a.configurable || false) === (b.configurable || false)
  			&& a.get === b.get
  			&& a.set === b.set;
  	}

  	isGetInvariant(target, property) {
  		const descriptor = this._getOwnPropertyDescriptor(target, property);

  		return descriptor !== undefined
  			&& descriptor.configurable !== true
  			&& descriptor.writable !== true;
  	}

  	unsubscribe() {
  		this._descriptorCache = null;
  		this._pathCache = null;
  		this._proxyCache = null;
  		this.isUnsubscribed = true;
  	}
  }

  function isObject(value) {
  	return toString.call(value) === '[object Object]';
  }

  function isDiffCertain() {
  	return true;
  }

  function isDiffArrays(clone, value) {
  	return clone.length !== value.length || clone.some((item, index) => value[index] !== item);
  }

  const IMMUTABLE_OBJECT_METHODS = new Set([
  	'hasOwnProperty',
  	'isPrototypeOf',
  	'propertyIsEnumerable',
  	'toLocaleString',
  	'toString',
  	'valueOf',
  ]);

  const IMMUTABLE_ARRAY_METHODS = new Set([
  	'concat',
  	'includes',
  	'indexOf',
  	'join',
  	'keys',
  	'lastIndexOf',
  ]);

  const MUTABLE_ARRAY_METHODS = {
  	push: isDiffCertain,
  	pop: isDiffCertain,
  	shift: isDiffCertain,
  	unshift: isDiffCertain,
  	copyWithin: isDiffArrays,
  	reverse: isDiffArrays,
  	sort: isDiffArrays,
  	splice: isDiffArrays,
  	flat: isDiffArrays,
  	fill: isDiffArrays,
  };

  const HANDLED_ARRAY_METHODS = new Set([
  	...IMMUTABLE_OBJECT_METHODS,
  	...IMMUTABLE_ARRAY_METHODS,
  	...Object.keys(MUTABLE_ARRAY_METHODS),
  ]);

  function isDiffSets(clone, value) {
  	if (clone.size !== value.size) {
  		return true;
  	}

  	for (const element of clone) {
  		if (!value.has(element)) {
  			return true;
  		}
  	}

  	return false;
  }

  const COLLECTION_ITERATOR_METHODS = [
  	'keys',
  	'values',
  	'entries',
  ];

  const IMMUTABLE_SET_METHODS = new Set([
  	'has',
  	'toString',
  ]);

  const MUTABLE_SET_METHODS = {
  	add: isDiffSets,
  	clear: isDiffSets,
  	delete: isDiffSets,
  	forEach: isDiffSets,
  };

  const HANDLED_SET_METHODS = new Set([
  	...IMMUTABLE_SET_METHODS,
  	...Object.keys(MUTABLE_SET_METHODS),
  	...COLLECTION_ITERATOR_METHODS,
  ]);

  function isDiffMaps(clone, value) {
  	if (clone.size !== value.size) {
  		return true;
  	}

  	let bValue;
  	for (const [key, aValue] of clone) {
  		bValue = value.get(key);

  		if (bValue !== aValue || (bValue === undefined && !value.has(key))) {
  			return true;
  		}
  	}

  	return false;
  }

  const IMMUTABLE_MAP_METHODS = new Set([...IMMUTABLE_SET_METHODS, 'get']);

  const MUTABLE_MAP_METHODS = {
  	set: isDiffMaps,
  	clear: isDiffMaps,
  	delete: isDiffMaps,
  	forEach: isDiffMaps,
  };

  const HANDLED_MAP_METHODS = new Set([
  	...IMMUTABLE_MAP_METHODS,
  	...Object.keys(MUTABLE_MAP_METHODS),
  	...COLLECTION_ITERATOR_METHODS,
  ]);

  class CloneObject {
  	constructor(value, path, argumentsList, hasOnValidate) {
  		this._path = path;
  		this._isChanged = false;
  		this._clonedCache = new Set();
  		this._hasOnValidate = hasOnValidate;
  		this._changes = hasOnValidate ? [] : null;

  		this.clone = path === undefined ? value : this._shallowClone(value);
  	}

  	static isHandledMethod(name) {
  		return IMMUTABLE_OBJECT_METHODS.has(name);
  	}

  	_shallowClone(value) {
  		let clone = value;

  		if (isObject(value)) {
  			clone = {...value};
  		} else if (isArray(value) || ArrayBuffer.isView(value)) {
  			clone = [...value];
  		} else if (value instanceof Date) {
  			clone = new Date(value);
  		} else if (value instanceof Set) {
  			clone = new Set([...value].map(item => this._shallowClone(item)));
  		} else if (value instanceof Map) {
  			clone = new Map();

  			for (const [key, item] of value.entries()) {
  				clone.set(key, this._shallowClone(item));
  			}
  		}

  		this._clonedCache.add(clone);

  		return clone;
  	}

  	preferredThisArg(isHandledMethod, name, thisArg, thisProxyTarget) {
  		if (isHandledMethod) {
  			if (isArray(thisProxyTarget)) {
  				this._onIsChanged = MUTABLE_ARRAY_METHODS[name];
  			} else if (thisProxyTarget instanceof Set) {
  				this._onIsChanged = MUTABLE_SET_METHODS[name];
  			} else if (thisProxyTarget instanceof Map) {
  				this._onIsChanged = MUTABLE_MAP_METHODS[name];
  			}

  			return thisProxyTarget;
  		}

  		return thisArg;
  	}

  	update(fullPath, property, value) {
  		const changePath = path.after(fullPath, this._path);

  		if (property !== 'length') {
  			let object = this.clone;

  			path.walk(changePath, key => {
  				if (object && object[key]) {
  					if (!this._clonedCache.has(object[key])) {
  						object[key] = this._shallowClone(object[key]);
  					}

  					object = object[key];
  				}
  			});

  			if (this._hasOnValidate) {
  				this._changes.push({
  					path: changePath,
  					property,
  					previous: value,
  				});
  			}

  			if (object && object[property]) {
  				object[property] = value;
  			}
  		}

  		this._isChanged = true;
  	}

  	undo(object) {
  		let change;

  		for (let index = this._changes.length - 1; index !== -1; index--) {
  			change = this._changes[index];

  			path.get(object, change.path)[change.property] = change.previous;
  		}
  	}

  	isChanged(value) {
  		return this._onIsChanged === undefined
  			? this._isChanged
  			: this._onIsChanged(this.clone, value);
  	}
  }

  class CloneArray extends CloneObject {
  	static isHandledMethod(name) {
  		return HANDLED_ARRAY_METHODS.has(name);
  	}
  }

  class CloneDate extends CloneObject {
  	undo(object) {
  		object.setTime(this.clone.getTime());
  	}

  	isChanged(value, equals) {
  		return !equals(this.clone.valueOf(), value.valueOf());
  	}
  }

  class CloneSet extends CloneObject {
  	static isHandledMethod(name) {
  		return HANDLED_SET_METHODS.has(name);
  	}

  	undo(object) {
  		for (const value of this.clone) {
  			object.add(value);
  		}

  		for (const value of object) {
  			if (!this.clone.has(value)) {
  				object.delete(value);
  			}
  		}
  	}
  }

  class CloneMap extends CloneObject {
  	static isHandledMethod(name) {
  		return HANDLED_MAP_METHODS.has(name);
  	}

  	undo(object) {
  		for (const [key, value] of this.clone.entries()) {
  			object.set(key, value);
  		}

  		for (const key of object.keys()) {
  			if (!this.clone.has(key)) {
  				object.delete(key);
  			}
  		}
  	}
  }

  class CloneWeakSet extends CloneObject {
  	constructor(value, path, argumentsList, hasOnValidate) {
  		super(undefined, path, argumentsList, hasOnValidate);

  		this._arg1 = argumentsList[0];
  		this._weakValue = value.has(this._arg1);
  	}

  	isChanged(value) {
  		return this._weakValue !== value.has(this._arg1);
  	}

  	undo(object) {
  		if (this._weakValue && !object.has(this._arg1)) {
  			object.add(this._arg1);
  		} else {
  			object.delete(this._arg1);
  		}
  	}
  }

  class CloneWeakMap extends CloneObject {
  	constructor(value, path, argumentsList, hasOnValidate) {
  		super(undefined, path, argumentsList, hasOnValidate);

  		this._weakKey = argumentsList[0];
  		this._weakHas = value.has(this._weakKey);
  		this._weakValue = value.get(this._weakKey);
  	}

  	isChanged(value) {
  		return this._weakValue !== value.get(this._weakKey);
  	}

  	undo(object) {
  		const weakHas = object.has(this._weakKey);

  		if (this._weakHas && !weakHas) {
  			object.set(this._weakKey, this._weakValue);
  		} else if (!this._weakHas && weakHas) {
  			object.delete(this._weakKey);
  		} else if (this._weakValue !== object.get(this._weakKey)) {
  			object.set(this._weakKey, this._weakValue);
  		}
  	}
  }

  class SmartClone {
  	constructor(hasOnValidate) {
  		this._stack = [];
  		this._hasOnValidate = hasOnValidate;
  	}

  	static isHandledType(value) {
  		return isObject(value)
  			|| isArray(value)
  			|| isBuiltinWithMutableMethods(value);
  	}

  	static isHandledMethod(target, name) {
  		if (isObject(target)) {
  			return CloneObject.isHandledMethod(name);
  		}

  		if (isArray(target)) {
  			return CloneArray.isHandledMethod(name);
  		}

  		if (target instanceof Set) {
  			return CloneSet.isHandledMethod(name);
  		}

  		if (target instanceof Map) {
  			return CloneMap.isHandledMethod(name);
  		}

  		return isBuiltinWithMutableMethods(target);
  	}

  	get isCloning() {
  		return this._stack.length > 0;
  	}

  	start(value, path, argumentsList) {
  		let CloneClass = CloneObject;

  		if (isArray(value)) {
  			CloneClass = CloneArray;
  		} else if (value instanceof Date) {
  			CloneClass = CloneDate;
  		} else if (value instanceof Set) {
  			CloneClass = CloneSet;
  		} else if (value instanceof Map) {
  			CloneClass = CloneMap;
  		} else if (value instanceof WeakSet) {
  			CloneClass = CloneWeakSet;
  		} else if (value instanceof WeakMap) {
  			CloneClass = CloneWeakMap;
  		}

  		this._stack.push(new CloneClass(value, path, argumentsList, this._hasOnValidate));
  	}

  	update(fullPath, property, value) {
  		this._stack[this._stack.length - 1].update(fullPath, property, value);
  	}

  	preferredThisArg(target, thisArg, thisProxyTarget) {
  		const {name} = target;
  		const isHandledMethod = SmartClone.isHandledMethod(thisProxyTarget, name);

  		return this._stack[this._stack.length - 1]
  			.preferredThisArg(isHandledMethod, name, thisArg, thisProxyTarget);
  	}

  	isChanged(isMutable, value, equals) {
  		return this._stack[this._stack.length - 1].isChanged(isMutable, value, equals);
  	}

  	undo(object) {
  		if (this._previousClone !== undefined) {
  			this._previousClone.undo(object);
  		}
  	}

  	stop() {
  		this._previousClone = this._stack.pop();

  		return this._previousClone.clone;
  	}
  }

  /* eslint-disable unicorn/prefer-spread */

  const defaultOptions = {
  	equals: Object.is,
  	isShallow: false,
  	pathAsArray: false,
  	ignoreSymbols: false,
  	ignoreUnderscores: false,
  	ignoreDetached: false,
  	details: false,
  };

  const onChange = (object, onChange, options = {}) => {
  	options = {
  		...defaultOptions,
  		...options,
  	};

  	const proxyTarget = Symbol('ProxyTarget');
  	const {equals, isShallow, ignoreDetached, details} = options;
  	const cache = new Cache(equals);
  	const hasOnValidate = typeof options.onValidate === 'function';
  	const smartClone = new SmartClone(hasOnValidate);

  	// eslint-disable-next-line max-params
  	const validate = (target, property, value, previous, applyData) => !hasOnValidate
  		|| smartClone.isCloning
  		|| options.onValidate(path.concat(cache.getPath(target), property), value, previous, applyData) === true;

  	const handleChangeOnTarget = (target, property, value, previous) => {
  		if (
  			!ignoreProperty(cache, options, property)
  			&& !(ignoreDetached && cache.isDetached(target, object))
  		) {
  			handleChange(cache.getPath(target), property, value, previous);
  		}
  	};

  	// eslint-disable-next-line max-params
  	const handleChange = (changePath, property, value, previous, applyData) => {
  		if (smartClone.isCloning) {
  			smartClone.update(changePath, property, previous);
  		} else {
  			onChange(path.concat(changePath, property), value, previous, applyData);
  		}
  	};

  	const getProxyTarget = value => value
  		? (value[proxyTarget] || value)
  		: value;

  	const prepareValue = (value, target, property, basePath) => {
  		if (
  			isBuiltinWithoutMutableMethods(value)
  			|| property === 'constructor'
  			|| (isShallow && !SmartClone.isHandledMethod(target, property))
  			|| ignoreProperty(cache, options, property)
  			|| cache.isGetInvariant(target, property)
  			|| (ignoreDetached && cache.isDetached(target, object))
  		) {
  			return value;
  		}

  		if (basePath === undefined) {
  			basePath = cache.getPath(target);
  		}

  		return cache.getProxy(value, path.concat(basePath, property), handler, proxyTarget);
  	};

  	const handler = {
  		get(target, property, receiver) {
  			if (isSymbol(property)) {
  				if (property === proxyTarget || property === TARGET) {
  					return target;
  				}

  				if (
  					property === UNSUBSCRIBE
  					&& !cache.isUnsubscribed
  					&& cache.getPath(target).length === 0
  				) {
  					cache.unsubscribe();
  					return target;
  				}
  			}

  			const value = isBuiltinWithMutableMethods(target)
  				? Reflect.get(target, property)
  				: Reflect.get(target, property, receiver);

  			return prepareValue(value, target, property);
  		},

  		set(target, property, value, receiver) {
  			value = getProxyTarget(value);

  			const reflectTarget = target[proxyTarget] || target;
  			const previous = reflectTarget[property];

  			if (equals(previous, value) && property in target) {
  				return true;
  			}

  			const isValid = validate(target, property, value, previous);

  			if (
  				isValid
  				&& cache.setProperty(reflectTarget, property, value, receiver, previous)
  			) {
  				handleChangeOnTarget(target, property, target[property], previous);

  				return true;
  			}

  			return !isValid;
  		},

  		defineProperty(target, property, descriptor) {
  			if (!cache.isSameDescriptor(descriptor, target, property)) {
  				const previous = target[property];

  				if (
  					validate(target, property, descriptor.value, previous)
  					&& cache.defineProperty(target, property, descriptor, previous)
  				) {
  					handleChangeOnTarget(target, property, descriptor.value, previous);
  				}
  			}

  			return true;
  		},

  		deleteProperty(target, property) {
  			if (!Reflect.has(target, property)) {
  				return true;
  			}

  			const previous = Reflect.get(target, property);
  			const isValid = validate(target, property, undefined, previous);

  			if (
  				isValid
  				&& cache.deleteProperty(target, property, previous)
  			) {
  				handleChangeOnTarget(target, property, undefined, previous);

  				return true;
  			}

  			return !isValid;
  		},

  		apply(target, thisArg, argumentsList) {
  			const thisProxyTarget = thisArg[proxyTarget] || thisArg;

  			if (cache.isUnsubscribed) {
  				return Reflect.apply(target, thisProxyTarget, argumentsList);
  			}

  			if (
  				(details === false
  					|| (details !== true && !details.includes(target.name)))
  				&& SmartClone.isHandledType(thisProxyTarget)
  			) {
  				let applyPath = path.initial(cache.getPath(target));
  				const isHandledMethod = SmartClone.isHandledMethod(thisProxyTarget, target.name);

  				smartClone.start(thisProxyTarget, applyPath, argumentsList);

  				let result = Reflect.apply(
  					target,
  					smartClone.preferredThisArg(target, thisArg, thisProxyTarget),
  					isHandledMethod
  						? argumentsList.map(argument => getProxyTarget(argument))
  						: argumentsList,
  				);

  				const isChanged = smartClone.isChanged(thisProxyTarget, equals);
  				const previous = smartClone.stop();

  				if (SmartClone.isHandledType(result) && isHandledMethod) {
  					if (thisArg instanceof Map && target.name === 'get') {
  						applyPath = path.concat(applyPath, argumentsList[0]);
  					}

  					result = cache.getProxy(result, applyPath, handler);
  				}

  				if (isChanged) {
  					const applyData = {
  						name: target.name,
  						args: argumentsList,
  						result,
  					};
  					const changePath = smartClone.isCloning
  						? path.initial(applyPath)
  						: applyPath;
  					const property = smartClone.isCloning
  						? path.last(applyPath)
  						: '';

  					if (validate(path.get(object, changePath), property, thisProxyTarget, previous, applyData)) {
  						handleChange(changePath, property, thisProxyTarget, previous, applyData);
  					} else {
  						smartClone.undo(thisProxyTarget);
  					}
  				}

  				if (
  					(thisArg instanceof Map || thisArg instanceof Set)
  					&& isIterator(result)
  				) {
  					return wrapIterator(result, target, thisArg, applyPath, prepareValue);
  				}

  				return result;
  			}

  			return Reflect.apply(target, thisArg, argumentsList);
  		},
  	};

  	const proxy = cache.getProxy(object, options.pathAsArray ? [] : '', handler);
  	onChange = onChange.bind(proxy);

  	if (hasOnValidate) {
  		options.onValidate = options.onValidate.bind(proxy);
  	}

  	return proxy;
  };

  onChange.target = proxy => (proxy && proxy[TARGET]) || proxy;
  onChange.unsubscribe = proxy => proxy[UNSUBSCRIBE] || proxy;

  class DivComponent {
    constructor() {
      this.el = document.createElement('div');
    }

    render() {
      this.el;
    }
  }

  class Header extends DivComponent {
    constructor(appState) {
      super();
      this.appState = appState;
    }

    render() {
      this.el.classList.add('header');
      this.el.innerHTML = `
      <div>
        <img src="static/logo.svg" alt="Логотип" /> 
      </div>
      <div class="menu">
        <a class="menu__item" href="#" /> 
          <img src="static/search.svg" alt="Поиск" /> 
          Поиск книг
        </a>
        <a class="menu__item" href="#favorites" /> 
          <img src="static/favorites.svg" alt="Избранное" /> 
          Избранное
          <div class="menu__counter">
            ${this.appState.favorites.length}
          </div>
        </a>
      </div>
    `;
      return this.el;
    }
  }

  class Search extends DivComponent {
    constructor(state) {
      super();
      this.state = state;
    }

    search() {
      const value = this.el.querySelector('input').value;
      this.state.searchQuery = value;
    }

    render() {
      this.el.classList.add('search');
      this.el.innerHTML = `
      <div class="search__wrapper">
        <input 
          type="text" 
          placeholder="Найти книгу или автора..." 
          class="search__input"
          value="${this.state.searchQuery ?? ''}"
        />
        <img src="static/search.svg" alt="Поиск" />
      </div>
      <button aria-label="искать"><img src="static/search-white.svg" alt="Поиск" /></button>
    `;
      this.el.querySelector('button').addEventListener('click', this.search.bind(this));
      this.el.querySelector('input').addEventListener('keydown', (e) => {
        if (e.code === 'Enter') {
          this.search();
        }
      });
      return this.el;
    }
  }

  class Card extends DivComponent {
    constructor(appState, cardState) {
      super();
      this.appState = appState;
      this.cardState = cardState;
    }

    #addToFavorite() {
      this.appState.favorites.push(this.cardState);
    }

    #deleteFromFavorite() {
      this.appState.favorites = this.appState.favorites.filter(
        (b) => b.key !== this.cardState.key
      );
    }

    render() {
      this.el.classList.add('card');
      const existInFavorites = this.appState.favorites.find(
        (b) => b.key === this.cardState.key
      );
      this.el.innerHTML = `
      <div class="card__image">
        <img src="https://covers.openlibrary.org/b/olid/${
          this.cardState.cover_edition_key
        }-M.jpg" alt="Обложка" />
      </div>
      <div class="card__info">
        <div class="card__tag">
          ${this.cardState.subject ? this.cardState.subject[0] : ' '}
        </div>
        <div class="card__name">
          <a class="card__link" href="${this.cardState.key.replace(/works/g, 'book-app/#books')}">
            ${this.cardState.title}
          </a>
        </div>
        <div class="card__author">
          ${this.cardState.author_name ? this.cardState.author_name[0] : ''}
        </div>
        <div class="card__footer">
          <button class="button__add ${existInFavorites ? 'button__active' : ''}">
            ${
              existInFavorites
                ? '<img src="static/favorites.svg" />'
                : '<img src="static/favorites-white.svg" />'
            }
          </button>
        </div>
      </div>
    `;

      if (existInFavorites) {
        this.el
          .querySelector('.button__active')
          .addEventListener('click', this.#deleteFromFavorite.bind(this));
      } else {
        this.el
          .querySelector('.button__add')
          .addEventListener('click', this.#addToFavorite.bind(this));
      }

      return this.el;
    }
  }

  class CardList extends DivComponent {
    constructor(appState, parrentState) {
      super();
      this.appState = appState;
      this.parrentState = parrentState;
    }

    render() {
      if (this.parrentState.loading) {
        this.el.innerHTML = `<div class="card_list__loader">Загрузка...</div>`;
        return this.el;
      }

      const cardGrid = document.createElement('div');
      cardGrid.classList.add('card_grid');
      this.el.append(cardGrid);

      for (const card of this.parrentState.list) {
        if (!card.cover_edition_key) {
          continue;
        }
        cardGrid.append(new Card(this.appState, card).render());
      }

      return this.el;
    }
  }

  async function loadList(q, offset) {
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${q}&offset=${offset}`
    );
    return res.json();
  }

  async function loadBook(q) {
    const res = await fetch(`https://openlibrary.org/works/${q}.json`);
    return res.json();
  }

  class MainView extends AbstractView {
    state = {
      list: [],
      numFound: 0,
      loading: false,
      searchQuery: undefined,
      offset: 0,
    };

    constructor(appState) {
      super();
      this.appState = appState;
      this.loadList = loadList;
      this.appState = onChange(this.appState, this.appStateHook.bind(this));
      this.state = onChange(this.state, this.stateHook.bind(this));
      this.setTitle('Поиск книг');
    }

    destroy() {
      onChange.unsubscribe(this.appState);
      onChange.unsubscribe(this.state);
    }

    appStateHook(path) {
      if (path === 'favorites') {
        this.render();
      }
    }

    async stateHook(path) {
      if (path === 'searchQuery') {
        this.state.loading = true;
        const data = await this.loadList(this.state.searchQuery, this.state.offset);
        this.state.loading = false;
        this.state.numFound = data.numFound;
        this.state.list = data.docs;

        this.appState.numFound = data.numFound;
        this.appState.list = data.docs;
      }

      if (path === 'list' || path === 'loading') {
        this.render();
      }
    }

    render() {
      const main = document.createElement('div');
      main.innerHTML = `<h1>Найдено книг — ${
      this.state.numFound === 0 ? this.appState.numFound : this.state.numFound
    }</h1>`;
      main.append(new Search(this.state).render());
      main.append(
        new CardList(
          this.appState,
          this.state.list && this.state.list.length ? this.state : this.appState
        ).render()
      );
      this.app.innerHTML = '';
      this.app.append(main);
      this.renderHeader();
    }

    renderHeader() {
      const header = new Header(this.appState).render();
      this.app.prepend(header);
    }
  }

  class FavoritesView extends AbstractView {
    constructor(appState) {
      super();
      this.appState = appState;
      this.appState = onChange(this.appState, this.appStateHook.bind(this));
      this.setTitle('Избранные книги');
    }

    destroy() {
      onChange.unsubscribe(this.appState);
    }

    appStateHook(path) {
      if (path === 'favorites') {
        this.render();
      }
    }

    render() {
      const main = document.createElement('div');
      main.innerHTML = '<h1>Избранные книги</h1>';
      main.append(new CardList(this.appState, { list: this.appState.favorites }).render());
      this.app.innerHTML = '';
      this.app.append(main);
      this.renderHeader();
    }

    renderHeader() {
      const header = new Header(this.appState).render();
      this.app.prepend(header);
    }
  }

  /**
   * marked v5.1.2 - a markdown parser
   * Copyright (c) 2011-2023, Christopher Jeffrey. (MIT Licensed)
   * https://github.com/markedjs/marked
   */

  /**
   * DO NOT EDIT THIS FILE
   * The code in this file is generated from files in ./src/
   */

  function getDefaults() {
    return {
      async: false,
      baseUrl: null,
      breaks: false,
      extensions: null,
      gfm: true,
      headerIds: true,
      headerPrefix: '',
      highlight: null,
      hooks: null,
      langPrefix: 'language-',
      mangle: true,
      pedantic: false,
      renderer: null,
      sanitize: false,
      sanitizer: null,
      silent: false,
      smartypants: false,
      tokenizer: null,
      walkTokens: null,
      xhtml: false
    };
  }

  let defaults = getDefaults();

  function changeDefaults(newDefaults) {
    defaults = newDefaults;
  }

  /**
   * Helpers
   */
  const escapeTest = /[&<>"']/;
  const escapeReplace = new RegExp(escapeTest.source, 'g');
  const escapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
  const escapeReplaceNoEncode = new RegExp(escapeTestNoEncode.source, 'g');
  const escapeReplacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  const getEscapeReplacement = (ch) => escapeReplacements[ch];
  function escape(html, encode) {
    if (encode) {
      if (escapeTest.test(html)) {
        return html.replace(escapeReplace, getEscapeReplacement);
      }
    } else {
      if (escapeTestNoEncode.test(html)) {
        return html.replace(escapeReplaceNoEncode, getEscapeReplacement);
      }
    }

    return html;
  }

  const unescapeTest = /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig;

  /**
   * @param {string} html
   */
  function unescape(html) {
    // explicitly match decimal, hex, and named HTML entities
    return html.replace(unescapeTest, (_, n) => {
      n = n.toLowerCase();
      if (n === 'colon') return ':';
      if (n.charAt(0) === '#') {
        return n.charAt(1) === 'x'
          ? String.fromCharCode(parseInt(n.substring(2), 16))
          : String.fromCharCode(+n.substring(1));
      }
      return '';
    });
  }

  const caret = /(^|[^\[])\^/g;

  /**
   * @param {string | RegExp} regex
   * @param {string} opt
   */
  function edit(regex, opt) {
    regex = typeof regex === 'string' ? regex : regex.source;
    opt = opt || '';
    const obj = {
      replace: (name, val) => {
        val = val.source || val;
        val = val.replace(caret, '$1');
        regex = regex.replace(name, val);
        return obj;
      },
      getRegex: () => {
        return new RegExp(regex, opt);
      }
    };
    return obj;
  }

  const nonWordAndColonTest = /[^\w:]/g;
  const originIndependentUrl = /^$|^[a-z][a-z0-9+.-]*:|^[?#]/i;

  /**
   * @param {boolean} sanitize
   * @param {string} base
   * @param {string} href
   */
  function cleanUrl(sanitize, base, href) {
    if (sanitize) {
      let prot;
      try {
        prot = decodeURIComponent(unescape(href))
          .replace(nonWordAndColonTest, '')
          .toLowerCase();
      } catch (e) {
        return null;
      }
      if (prot.indexOf('javascript:') === 0 || prot.indexOf('vbscript:') === 0 || prot.indexOf('data:') === 0) {
        return null;
      }
    }
    if (base && !originIndependentUrl.test(href)) {
      href = resolveUrl(base, href);
    }
    try {
      href = encodeURI(href).replace(/%25/g, '%');
    } catch (e) {
      return null;
    }
    return href;
  }

  const baseUrls = {};
  const justDomain = /^[^:]+:\/*[^/]*$/;
  const protocol = /^([^:]+:)[\s\S]*$/;
  const domain = /^([^:]+:\/*[^/]*)[\s\S]*$/;

  /**
   * @param {string} base
   * @param {string} href
   */
  function resolveUrl(base, href) {
    if (!baseUrls[' ' + base]) {
      // we can ignore everything in base after the last slash of its path component,
      // but we might need to add _that_
      // https://tools.ietf.org/html/rfc3986#section-3
      if (justDomain.test(base)) {
        baseUrls[' ' + base] = base + '/';
      } else {
        baseUrls[' ' + base] = rtrim(base, '/', true);
      }
    }
    base = baseUrls[' ' + base];
    const relativeBase = base.indexOf(':') === -1;

    if (href.substring(0, 2) === '//') {
      if (relativeBase) {
        return href;
      }
      return base.replace(protocol, '$1') + href;
    } else if (href.charAt(0) === '/') {
      if (relativeBase) {
        return href;
      }
      return base.replace(domain, '$1') + href;
    } else {
      return base + href;
    }
  }

  const noopTest = { exec: function noopTest() {} };

  function splitCells(tableRow, count) {
    // ensure that every cell-delimiting pipe has a space
    // before it to distinguish it from an escaped pipe
    const row = tableRow.replace(/\|/g, (match, offset, str) => {
        let escaped = false,
          curr = offset;
        while (--curr >= 0 && str[curr] === '\\') escaped = !escaped;
        if (escaped) {
          // odd number of slashes means | is escaped
          // so we leave it alone
          return '|';
        } else {
          // add space before unescaped |
          return ' |';
        }
      }),
      cells = row.split(/ \|/);
    let i = 0;

    // First/last cell in a row cannot be empty if it has no leading/trailing pipe
    if (!cells[0].trim()) { cells.shift(); }
    if (cells.length > 0 && !cells[cells.length - 1].trim()) { cells.pop(); }

    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push('');
    }

    for (; i < cells.length; i++) {
      // leading or trailing whitespace is ignored per the gfm spec
      cells[i] = cells[i].trim().replace(/\\\|/g, '|');
    }
    return cells;
  }

  /**
   * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
   * /c*$/ is vulnerable to REDOS.
   *
   * @param {string} str
   * @param {string} c
   * @param {boolean} invert Remove suffix of non-c chars instead. Default falsey.
   */
  function rtrim(str, c, invert) {
    const l = str.length;
    if (l === 0) {
      return '';
    }

    // Length of suffix matching the invert condition.
    let suffLen = 0;

    // Step left until we fail to match the invert condition.
    while (suffLen < l) {
      const currChar = str.charAt(l - suffLen - 1);
      if (currChar === c && !invert) {
        suffLen++;
      } else if (currChar !== c && invert) {
        suffLen++;
      } else {
        break;
      }
    }

    return str.slice(0, l - suffLen);
  }

  function findClosingBracket(str, b) {
    if (str.indexOf(b[1]) === -1) {
      return -1;
    }
    const l = str.length;
    let level = 0,
      i = 0;
    for (; i < l; i++) {
      if (str[i] === '\\') {
        i++;
      } else if (str[i] === b[0]) {
        level++;
      } else if (str[i] === b[1]) {
        level--;
        if (level < 0) {
          return i;
        }
      }
    }
    return -1;
  }

  function checkDeprecations(opt, callback) {
    if (!opt || opt.silent) {
      return;
    }

    if (callback) {
      console.warn('marked(): callback is deprecated since version 5.0.0, should not be used and will be removed in the future. Read more here: https://marked.js.org/using_pro#async');
    }

    if (opt.sanitize || opt.sanitizer) {
      console.warn('marked(): sanitize and sanitizer parameters are deprecated since version 0.7.0, should not be used and will be removed in the future. Read more here: https://marked.js.org/#/USING_ADVANCED.md#options');
    }

    if (opt.highlight || opt.langPrefix !== 'language-') {
      console.warn('marked(): highlight and langPrefix parameters are deprecated since version 5.0.0, should not be used and will be removed in the future. Instead use https://www.npmjs.com/package/marked-highlight.');
    }

    if (opt.mangle) {
      console.warn('marked(): mangle parameter is enabled by default, but is deprecated since version 5.0.0, and will be removed in the future. To clear this warning, install https://www.npmjs.com/package/marked-mangle, or disable by setting `{mangle: false}`.');
    }

    if (opt.baseUrl) {
      console.warn('marked(): baseUrl parameter is deprecated since version 5.0.0, should not be used and will be removed in the future. Instead use https://www.npmjs.com/package/marked-base-url.');
    }

    if (opt.smartypants) {
      console.warn('marked(): smartypants parameter is deprecated since version 5.0.0, should not be used and will be removed in the future. Instead use https://www.npmjs.com/package/marked-smartypants.');
    }

    if (opt.xhtml) {
      console.warn('marked(): xhtml parameter is deprecated since version 5.0.0, should not be used and will be removed in the future. Instead use https://www.npmjs.com/package/marked-xhtml.');
    }

    if (opt.headerIds || opt.headerPrefix) {
      console.warn('marked(): headerIds and headerPrefix parameters enabled by default, but are deprecated since version 5.0.0, and will be removed in the future. To clear this warning, install  https://www.npmjs.com/package/marked-gfm-heading-id, or disable by setting `{headerIds: false}`.');
    }
  }

  function outputLink(cap, link, raw, lexer) {
    const href = link.href;
    const title = link.title ? escape(link.title) : null;
    const text = cap[1].replace(/\\([\[\]])/g, '$1');

    if (cap[0].charAt(0) !== '!') {
      lexer.state.inLink = true;
      const token = {
        type: 'link',
        raw,
        href,
        title,
        text,
        tokens: lexer.inlineTokens(text)
      };
      lexer.state.inLink = false;
      return token;
    }
    return {
      type: 'image',
      raw,
      href,
      title,
      text: escape(text)
    };
  }

  function indentCodeCompensation(raw, text) {
    const matchIndentToCode = raw.match(/^(\s+)(?:```)/);

    if (matchIndentToCode === null) {
      return text;
    }

    const indentToCode = matchIndentToCode[1];

    return text
      .split('\n')
      .map(node => {
        const matchIndentInNode = node.match(/^\s+/);
        if (matchIndentInNode === null) {
          return node;
        }

        const [indentInNode] = matchIndentInNode;

        if (indentInNode.length >= indentToCode.length) {
          return node.slice(indentToCode.length);
        }

        return node;
      })
      .join('\n');
  }

  /**
   * Tokenizer
   */
  class Tokenizer {
    constructor(options) {
      this.options = options || defaults;
    }

    space(src) {
      const cap = this.rules.block.newline.exec(src);
      if (cap && cap[0].length > 0) {
        return {
          type: 'space',
          raw: cap[0]
        };
      }
    }

    code(src) {
      const cap = this.rules.block.code.exec(src);
      if (cap) {
        const text = cap[0].replace(/^ {1,4}/gm, '');
        return {
          type: 'code',
          raw: cap[0],
          codeBlockStyle: 'indented',
          text: !this.options.pedantic
            ? rtrim(text, '\n')
            : text
        };
      }
    }

    fences(src) {
      const cap = this.rules.block.fences.exec(src);
      if (cap) {
        const raw = cap[0];
        const text = indentCodeCompensation(raw, cap[3] || '');

        return {
          type: 'code',
          raw,
          lang: cap[2] ? cap[2].trim().replace(this.rules.inline._escapes, '$1') : cap[2],
          text
        };
      }
    }

    heading(src) {
      const cap = this.rules.block.heading.exec(src);
      if (cap) {
        let text = cap[2].trim();

        // remove trailing #s
        if (/#$/.test(text)) {
          const trimmed = rtrim(text, '#');
          if (this.options.pedantic) {
            text = trimmed.trim();
          } else if (!trimmed || / $/.test(trimmed)) {
            // CommonMark requires space before trailing #s
            text = trimmed.trim();
          }
        }

        return {
          type: 'heading',
          raw: cap[0],
          depth: cap[1].length,
          text,
          tokens: this.lexer.inline(text)
        };
      }
    }

    hr(src) {
      const cap = this.rules.block.hr.exec(src);
      if (cap) {
        return {
          type: 'hr',
          raw: cap[0]
        };
      }
    }

    blockquote(src) {
      const cap = this.rules.block.blockquote.exec(src);
      if (cap) {
        const text = cap[0].replace(/^ *>[ \t]?/gm, '');
        const top = this.lexer.state.top;
        this.lexer.state.top = true;
        const tokens = this.lexer.blockTokens(text);
        this.lexer.state.top = top;
        return {
          type: 'blockquote',
          raw: cap[0],
          tokens,
          text
        };
      }
    }

    list(src) {
      let cap = this.rules.block.list.exec(src);
      if (cap) {
        let raw, istask, ischecked, indent, i, blankLine, endsWithBlankLine,
          line, nextLine, rawLine, itemContents, endEarly;

        let bull = cap[1].trim();
        const isordered = bull.length > 1;

        const list = {
          type: 'list',
          raw: '',
          ordered: isordered,
          start: isordered ? +bull.slice(0, -1) : '',
          loose: false,
          items: []
        };

        bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

        if (this.options.pedantic) {
          bull = isordered ? bull : '[*+-]';
        }

        // Get next list item
        const itemRegex = new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`);

        // Check if current bullet point can start a new List Item
        while (src) {
          endEarly = false;
          if (!(cap = itemRegex.exec(src))) {
            break;
          }

          if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
            break;
          }

          raw = cap[0];
          src = src.substring(raw.length);

          line = cap[2].split('\n', 1)[0].replace(/^\t+/, (t) => ' '.repeat(3 * t.length));
          nextLine = src.split('\n', 1)[0];

          if (this.options.pedantic) {
            indent = 2;
            itemContents = line.trimLeft();
          } else {
            indent = cap[2].search(/[^ ]/); // Find first non-space char
            indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
            itemContents = line.slice(indent);
            indent += cap[1].length;
          }

          blankLine = false;

          if (!line && /^ *$/.test(nextLine)) { // Items begin with at most one blank line
            raw += nextLine + '\n';
            src = src.substring(nextLine.length + 1);
            endEarly = true;
          }

          if (!endEarly) {
            const nextBulletRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`);
            const hrRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`);
            const fencesBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`);
            const headingBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`);

            // Check if following lines should be included in List Item
            while (src) {
              rawLine = src.split('\n', 1)[0];
              nextLine = rawLine;

              // Re-align to follow commonmark nesting rules
              if (this.options.pedantic) {
                nextLine = nextLine.replace(/^ {1,4}(?=( {4})*[^ ])/g, '  ');
              }

              // End list item if found code fences
              if (fencesBeginRegex.test(nextLine)) {
                break;
              }

              // End list item if found start of new heading
              if (headingBeginRegex.test(nextLine)) {
                break;
              }

              // End list item if found start of new bullet
              if (nextBulletRegex.test(nextLine)) {
                break;
              }

              // Horizontal rule found
              if (hrRegex.test(src)) {
                break;
              }

              if (nextLine.search(/[^ ]/) >= indent || !nextLine.trim()) { // Dedent if possible
                itemContents += '\n' + nextLine.slice(indent);
              } else {
                // not enough indentation
                if (blankLine) {
                  break;
                }

                // paragraph continuation unless last line was a different block level element
                if (line.search(/[^ ]/) >= 4) { // indented code block
                  break;
                }
                if (fencesBeginRegex.test(line)) {
                  break;
                }
                if (headingBeginRegex.test(line)) {
                  break;
                }
                if (hrRegex.test(line)) {
                  break;
                }

                itemContents += '\n' + nextLine;
              }

              if (!blankLine && !nextLine.trim()) { // Check if current line is blank
                blankLine = true;
              }

              raw += rawLine + '\n';
              src = src.substring(rawLine.length + 1);
              line = nextLine.slice(indent);
            }
          }

          if (!list.loose) {
            // If the previous item ended with a blank line, the list is loose
            if (endsWithBlankLine) {
              list.loose = true;
            } else if (/\n *\n *$/.test(raw)) {
              endsWithBlankLine = true;
            }
          }

          // Check for task list items
          if (this.options.gfm) {
            istask = /^\[[ xX]\] /.exec(itemContents);
            if (istask) {
              ischecked = istask[0] !== '[ ] ';
              itemContents = itemContents.replace(/^\[[ xX]\] +/, '');
            }
          }

          list.items.push({
            type: 'list_item',
            raw,
            task: !!istask,
            checked: ischecked,
            loose: false,
            text: itemContents
          });

          list.raw += raw;
        }

        // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
        list.items[list.items.length - 1].raw = raw.trimRight();
        list.items[list.items.length - 1].text = itemContents.trimRight();
        list.raw = list.raw.trimRight();

        const l = list.items.length;

        // Item child tokens handled here at end because we needed to have the final item to trim it first
        for (i = 0; i < l; i++) {
          this.lexer.state.top = false;
          list.items[i].tokens = this.lexer.blockTokens(list.items[i].text, []);

          if (!list.loose) {
            // Check if list should be loose
            const spacers = list.items[i].tokens.filter(t => t.type === 'space');
            const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => /\n.*\n/.test(t.raw));

            list.loose = hasMultipleLineBreaks;
          }
        }

        // Set all items to loose if list is loose
        if (list.loose) {
          for (i = 0; i < l; i++) {
            list.items[i].loose = true;
          }
        }

        return list;
      }
    }

    html(src) {
      const cap = this.rules.block.html.exec(src);
      if (cap) {
        const token = {
          type: 'html',
          block: true,
          raw: cap[0],
          pre: !this.options.sanitizer
            && (cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style'),
          text: cap[0]
        };
        if (this.options.sanitize) {
          const text = this.options.sanitizer ? this.options.sanitizer(cap[0]) : escape(cap[0]);
          token.type = 'paragraph';
          token.text = text;
          token.tokens = this.lexer.inline(text);
        }
        return token;
      }
    }

    def(src) {
      const cap = this.rules.block.def.exec(src);
      if (cap) {
        const tag = cap[1].toLowerCase().replace(/\s+/g, ' ');
        const href = cap[2] ? cap[2].replace(/^<(.*)>$/, '$1').replace(this.rules.inline._escapes, '$1') : '';
        const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline._escapes, '$1') : cap[3];
        return {
          type: 'def',
          tag,
          raw: cap[0],
          href,
          title
        };
      }
    }

    table(src) {
      const cap = this.rules.block.table.exec(src);
      if (cap) {
        const item = {
          type: 'table',
          header: splitCells(cap[1]).map(c => { return { text: c }; }),
          align: cap[2].replace(/^ *|\| *$/g, '').split(/ *\| */),
          rows: cap[3] && cap[3].trim() ? cap[3].replace(/\n[ \t]*$/, '').split('\n') : []
        };

        if (item.header.length === item.align.length) {
          item.raw = cap[0];

          let l = item.align.length;
          let i, j, k, row;
          for (i = 0; i < l; i++) {
            if (/^ *-+: *$/.test(item.align[i])) {
              item.align[i] = 'right';
            } else if (/^ *:-+: *$/.test(item.align[i])) {
              item.align[i] = 'center';
            } else if (/^ *:-+ *$/.test(item.align[i])) {
              item.align[i] = 'left';
            } else {
              item.align[i] = null;
            }
          }

          l = item.rows.length;
          for (i = 0; i < l; i++) {
            item.rows[i] = splitCells(item.rows[i], item.header.length).map(c => { return { text: c }; });
          }

          // parse child tokens inside headers and cells

          // header child tokens
          l = item.header.length;
          for (j = 0; j < l; j++) {
            item.header[j].tokens = this.lexer.inline(item.header[j].text);
          }

          // cell child tokens
          l = item.rows.length;
          for (j = 0; j < l; j++) {
            row = item.rows[j];
            for (k = 0; k < row.length; k++) {
              row[k].tokens = this.lexer.inline(row[k].text);
            }
          }

          return item;
        }
      }
    }

    lheading(src) {
      const cap = this.rules.block.lheading.exec(src);
      if (cap) {
        return {
          type: 'heading',
          raw: cap[0],
          depth: cap[2].charAt(0) === '=' ? 1 : 2,
          text: cap[1],
          tokens: this.lexer.inline(cap[1])
        };
      }
    }

    paragraph(src) {
      const cap = this.rules.block.paragraph.exec(src);
      if (cap) {
        const text = cap[1].charAt(cap[1].length - 1) === '\n'
          ? cap[1].slice(0, -1)
          : cap[1];
        return {
          type: 'paragraph',
          raw: cap[0],
          text,
          tokens: this.lexer.inline(text)
        };
      }
    }

    text(src) {
      const cap = this.rules.block.text.exec(src);
      if (cap) {
        return {
          type: 'text',
          raw: cap[0],
          text: cap[0],
          tokens: this.lexer.inline(cap[0])
        };
      }
    }

    escape(src) {
      const cap = this.rules.inline.escape.exec(src);
      if (cap) {
        return {
          type: 'escape',
          raw: cap[0],
          text: escape(cap[1])
        };
      }
    }

    tag(src) {
      const cap = this.rules.inline.tag.exec(src);
      if (cap) {
        if (!this.lexer.state.inLink && /^<a /i.test(cap[0])) {
          this.lexer.state.inLink = true;
        } else if (this.lexer.state.inLink && /^<\/a>/i.test(cap[0])) {
          this.lexer.state.inLink = false;
        }
        if (!this.lexer.state.inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
          this.lexer.state.inRawBlock = true;
        } else if (this.lexer.state.inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
          this.lexer.state.inRawBlock = false;
        }

        return {
          type: this.options.sanitize
            ? 'text'
            : 'html',
          raw: cap[0],
          inLink: this.lexer.state.inLink,
          inRawBlock: this.lexer.state.inRawBlock,
          block: false,
          text: this.options.sanitize
            ? (this.options.sanitizer
              ? this.options.sanitizer(cap[0])
              : escape(cap[0]))
            : cap[0]
        };
      }
    }

    link(src) {
      const cap = this.rules.inline.link.exec(src);
      if (cap) {
        const trimmedUrl = cap[2].trim();
        if (!this.options.pedantic && /^</.test(trimmedUrl)) {
          // commonmark requires matching angle brackets
          if (!(/>$/.test(trimmedUrl))) {
            return;
          }

          // ending angle bracket cannot be escaped
          const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
          if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
            return;
          }
        } else {
          // find closing parenthesis
          const lastParenIndex = findClosingBracket(cap[2], '()');
          if (lastParenIndex > -1) {
            const start = cap[0].indexOf('!') === 0 ? 5 : 4;
            const linkLen = start + cap[1].length + lastParenIndex;
            cap[2] = cap[2].substring(0, lastParenIndex);
            cap[0] = cap[0].substring(0, linkLen).trim();
            cap[3] = '';
          }
        }
        let href = cap[2];
        let title = '';
        if (this.options.pedantic) {
          // split pedantic href and title
          const link = /^([^'"]*[^\s])\s+(['"])(.*)\2/.exec(href);

          if (link) {
            href = link[1];
            title = link[3];
          }
        } else {
          title = cap[3] ? cap[3].slice(1, -1) : '';
        }

        href = href.trim();
        if (/^</.test(href)) {
          if (this.options.pedantic && !(/>$/.test(trimmedUrl))) {
            // pedantic allows starting angle bracket without ending angle bracket
            href = href.slice(1);
          } else {
            href = href.slice(1, -1);
          }
        }
        return outputLink(cap, {
          href: href ? href.replace(this.rules.inline._escapes, '$1') : href,
          title: title ? title.replace(this.rules.inline._escapes, '$1') : title
        }, cap[0], this.lexer);
      }
    }

    reflink(src, links) {
      let cap;
      if ((cap = this.rules.inline.reflink.exec(src))
          || (cap = this.rules.inline.nolink.exec(src))) {
        let link = (cap[2] || cap[1]).replace(/\s+/g, ' ');
        link = links[link.toLowerCase()];
        if (!link) {
          const text = cap[0].charAt(0);
          return {
            type: 'text',
            raw: text,
            text
          };
        }
        return outputLink(cap, link, cap[0], this.lexer);
      }
    }

    emStrong(src, maskedSrc, prevChar = '') {
      let match = this.rules.inline.emStrong.lDelim.exec(src);
      if (!match) return;

      // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
      if (match[3] && prevChar.match(/[\p{L}\p{N}]/u)) return;

      const nextChar = match[1] || match[2] || '';

      if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
        const lLength = match[0].length - 1;
        let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

        const endReg = match[0][0] === '*' ? this.rules.inline.emStrong.rDelimAst : this.rules.inline.emStrong.rDelimUnd;
        endReg.lastIndex = 0;

        // Clip maskedSrc to same section of string as src (move to lexer?)
        maskedSrc = maskedSrc.slice(-1 * src.length + lLength);

        while ((match = endReg.exec(maskedSrc)) != null) {
          rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

          if (!rDelim) continue; // skip single * in __abc*abc__

          rLength = rDelim.length;

          if (match[3] || match[4]) { // found another Left Delim
            delimTotal += rLength;
            continue;
          } else if (match[5] || match[6]) { // either Left or Right Delim
            if (lLength % 3 && !((lLength + rLength) % 3)) {
              midDelimTotal += rLength;
              continue; // CommonMark Emphasis Rules 9-10
            }
          }

          delimTotal -= rLength;

          if (delimTotal > 0) continue; // Haven't found enough closing delimiters

          // Remove extra characters. *a*** -> *a*
          rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);

          const raw = src.slice(0, lLength + match.index + rLength + 1);

          // Create `em` if smallest delimiter has odd char count. *a***
          if (Math.min(lLength, rLength) % 2) {
            const text = raw.slice(1, -1);
            return {
              type: 'em',
              raw,
              text,
              tokens: this.lexer.inlineTokens(text)
            };
          }

          // Create 'strong' if smallest delimiter has even char count. **a***
          const text = raw.slice(2, -2);
          return {
            type: 'strong',
            raw,
            text,
            tokens: this.lexer.inlineTokens(text)
          };
        }
      }
    }

    codespan(src) {
      const cap = this.rules.inline.code.exec(src);
      if (cap) {
        let text = cap[2].replace(/\n/g, ' ');
        const hasNonSpaceChars = /[^ ]/.test(text);
        const hasSpaceCharsOnBothEnds = /^ /.test(text) && / $/.test(text);
        if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
          text = text.substring(1, text.length - 1);
        }
        text = escape(text, true);
        return {
          type: 'codespan',
          raw: cap[0],
          text
        };
      }
    }

    br(src) {
      const cap = this.rules.inline.br.exec(src);
      if (cap) {
        return {
          type: 'br',
          raw: cap[0]
        };
      }
    }

    del(src) {
      const cap = this.rules.inline.del.exec(src);
      if (cap) {
        return {
          type: 'del',
          raw: cap[0],
          text: cap[2],
          tokens: this.lexer.inlineTokens(cap[2])
        };
      }
    }

    autolink(src, mangle) {
      const cap = this.rules.inline.autolink.exec(src);
      if (cap) {
        let text, href;
        if (cap[2] === '@') {
          text = escape(this.options.mangle ? mangle(cap[1]) : cap[1]);
          href = 'mailto:' + text;
        } else {
          text = escape(cap[1]);
          href = text;
        }

        return {
          type: 'link',
          raw: cap[0],
          text,
          href,
          tokens: [
            {
              type: 'text',
              raw: text,
              text
            }
          ]
        };
      }
    }

    url(src, mangle) {
      let cap;
      if (cap = this.rules.inline.url.exec(src)) {
        let text, href;
        if (cap[2] === '@') {
          text = escape(this.options.mangle ? mangle(cap[0]) : cap[0]);
          href = 'mailto:' + text;
        } else {
          // do extended autolink path validation
          let prevCapZero;
          do {
            prevCapZero = cap[0];
            cap[0] = this.rules.inline._backpedal.exec(cap[0])[0];
          } while (prevCapZero !== cap[0]);
          text = escape(cap[0]);
          if (cap[1] === 'www.') {
            href = 'http://' + cap[0];
          } else {
            href = cap[0];
          }
        }
        return {
          type: 'link',
          raw: cap[0],
          text,
          href,
          tokens: [
            {
              type: 'text',
              raw: text,
              text
            }
          ]
        };
      }
    }

    inlineText(src, smartypants) {
      const cap = this.rules.inline.text.exec(src);
      if (cap) {
        let text;
        if (this.lexer.state.inRawBlock) {
          text = this.options.sanitize ? (this.options.sanitizer ? this.options.sanitizer(cap[0]) : escape(cap[0])) : cap[0];
        } else {
          text = escape(this.options.smartypants ? smartypants(cap[0]) : cap[0]);
        }
        return {
          type: 'text',
          raw: cap[0],
          text
        };
      }
    }
  }

  /**
   * Block-Level Grammar
   */
  const block = {
    newline: /^(?: *(?:\n|$))+/,
    code: /^( {4}[^\n]+(?:\n(?: *(?:\n|$))*)?)+/,
    fences: /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,
    hr: /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,
    heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,
    blockquote: /^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/,
    list: /^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/,
    html: '^ {0,3}(?:' // optional indentation
      + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)' // (1)
      + '|comment[^\\n]*(\\n+|$)' // (2)
      + '|<\\?[\\s\\S]*?(?:\\?>\\n*|$)' // (3)
      + '|<![A-Z][\\s\\S]*?(?:>\\n*|$)' // (4)
      + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)' // (5)
      + '|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n *)+\\n|$)' // (6)
      + '|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$)' // (7) open tag
      + '|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$)' // (7) closing tag
      + ')',
    def: /^ {0,3}\[(label)\]: *(?:\n *)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n *)?| *\n *)(title))? *(?:\n+|$)/,
    table: noopTest,
    lheading: /^((?:(?!^bull ).|\n(?!\n|bull ))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
    // regex template, placeholders will be replaced according to different paragraph
    // interruption rules of commonmark and the original markdown spec:
    _paragraph: /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,
    text: /^[^\n]+/
  };

  block._label = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
  block._title = /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/;
  block.def = edit(block.def)
    .replace('label', block._label)
    .replace('title', block._title)
    .getRegex();

  block.bullet = /(?:[*+-]|\d{1,9}[.)])/;
  block.listItemStart = edit(/^( *)(bull) */)
    .replace('bull', block.bullet)
    .getRegex();

  block.list = edit(block.list)
    .replace(/bull/g, block.bullet)
    .replace('hr', '\\n+(?=\\1?(?:(?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$))')
    .replace('def', '\\n+(?=' + block.def.source + ')')
    .getRegex();

  block._tag = 'address|article|aside|base|basefont|blockquote|body|caption'
    + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
    + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
    + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
    + '|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr'
    + '|track|ul';
  block._comment = /<!--(?!-?>)[\s\S]*?(?:-->|$)/;
  block.html = edit(block.html, 'i')
    .replace('comment', block._comment)
    .replace('tag', block._tag)
    .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
    .getRegex();

  block.lheading = edit(block.lheading)
    .replace(/bull/g, block.bullet) // lists can interrupt
    .getRegex();

  block.paragraph = edit(block._paragraph)
    .replace('hr', block.hr)
    .replace('heading', ' {0,3}#{1,6} ')
    .replace('|lheading', '') // setex headings don't interrupt commonmark paragraphs
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', block._tag) // pars can be interrupted by type (6) html blocks
    .getRegex();

  block.blockquote = edit(block.blockquote)
    .replace('paragraph', block.paragraph)
    .getRegex();

  /**
   * Normal Block Grammar
   */

  block.normal = { ...block };

  /**
   * GFM Block Grammar
   */

  block.gfm = {
    ...block.normal,
    table: '^ *([^\\n ].*\\|.*)\\n' // Header
      + ' {0,3}(?:\\| *)?(:?-+:? *(?:\\| *:?-+:? *)*)(?:\\| *)?' // Align
      + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)' // Cells
  };

  block.gfm.table = edit(block.gfm.table)
    .replace('hr', block.hr)
    .replace('heading', ' {0,3}#{1,6} ')
    .replace('blockquote', ' {0,3}>')
    .replace('code', ' {4}[^\\n]')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', block._tag) // tables can be interrupted by type (6) html blocks
    .getRegex();

  block.gfm.paragraph = edit(block._paragraph)
    .replace('hr', block.hr)
    .replace('heading', ' {0,3}#{1,6} ')
    .replace('|lheading', '') // setex headings don't interrupt commonmark paragraphs
    .replace('table', block.gfm.table) // interrupt paragraphs with table
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', block._tag) // pars can be interrupted by type (6) html blocks
    .getRegex();
  /**
   * Pedantic grammar (original John Gruber's loose markdown specification)
   */

  block.pedantic = {
    ...block.normal,
    html: edit(
      '^ *(?:comment *(?:\\n|\\s*$)'
      + '|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)' // closed tag
      + '|<tag(?:"[^"]*"|\'[^\']*\'|\\s[^\'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))')
      .replace('comment', block._comment)
      .replace(/tag/g, '(?!(?:'
        + 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub'
        + '|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)'
        + '\\b)\\w+(?!:|[^\\w\\s@]*@)\\b')
      .getRegex(),
    def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
    heading: /^(#{1,6})(.*)(?:\n+|$)/,
    fences: noopTest, // fences not supported
    lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
    paragraph: edit(block.normal._paragraph)
      .replace('hr', block.hr)
      .replace('heading', ' *#{1,6} *[^\n]')
      .replace('lheading', block.lheading)
      .replace('blockquote', ' {0,3}>')
      .replace('|fences', '')
      .replace('|list', '')
      .replace('|html', '')
      .getRegex()
  };

  /**
   * Inline-Level Grammar
   */
  const inline = {
    escape: /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,
    autolink: /^<(scheme:[^\s\x00-\x1f<>]*|email)>/,
    url: noopTest,
    tag: '^comment'
      + '|^</[a-zA-Z][\\w:-]*\\s*>' // self-closing tag
      + '|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>' // open tag
      + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
      + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
      + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>', // CDATA section
    link: /^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/,
    reflink: /^!?\[(label)\]\[(ref)\]/,
    nolink: /^!?\[(ref)\](?:\[\])?/,
    reflinkSearch: 'reflink|nolink(?!\\()',
    emStrong: {
      lDelim: /^(?:\*+(?:((?!\*)[punct])|[^\s*]))|^_+(?:((?!_)[punct])|([^\s_]))/,
      //         (1) and (2) can only be a Right Delimiter. (3) and (4) can only be Left.  (5) and (6) can be either Left or Right.
      //         | Skip orphan inside strong      | Consume to delim | (1) #***              | (2) a***#, a***                    | (3) #***a, ***a                  | (4) ***#                 | (5) #***#                         | (6) a***a
      rDelimAst: /^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\*)[punct](\*+)(?=[\s]|$)|[^punct\s](\*+)(?!\*)(?=[punct\s]|$)|(?!\*)[punct\s](\*+)(?=[^punct\s])|[\s](\*+)(?!\*)(?=[punct])|(?!\*)[punct](\*+)(?!\*)(?=[punct])|[^punct\s](\*+)(?=[^punct\s])/,
      rDelimUnd: /^[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)|[^_]+(?=[^_])|(?!_)[punct](_+)(?=[\s]|$)|[^punct\s](_+)(?!_)(?=[punct\s]|$)|(?!_)[punct\s](_+)(?=[^punct\s])|[\s](_+)(?!_)(?=[punct])|(?!_)[punct](_+)(?!_)(?=[punct])/ // ^- Not allowed for _
    },
    code: /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,
    br: /^( {2,}|\\)\n(?!\s*$)/,
    del: noopTest,
    text: /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,
    punctuation: /^((?![*_])[\spunctuation])/
  };

  // list of unicode punctuation marks, plus any missing characters from CommonMark spec
  inline._punctuation = '\\p{P}$+<=>`^|~';
  inline.punctuation = edit(inline.punctuation, 'u').replace(/punctuation/g, inline._punctuation).getRegex();

  // sequences em should skip over [title](link), `code`, <html>
  inline.blockSkip = /\[[^[\]]*?\]\([^\(\)]*?\)|`[^`]*?`|<[^<>]*?>/g;
  inline.anyPunctuation = /\\[punct]/g;
  inline._escapes = /\\([punct])/g;

  inline._comment = edit(block._comment).replace('(?:-->|$)', '-->').getRegex();

  inline.emStrong.lDelim = edit(inline.emStrong.lDelim, 'u')
    .replace(/punct/g, inline._punctuation)
    .getRegex();

  inline.emStrong.rDelimAst = edit(inline.emStrong.rDelimAst, 'gu')
    .replace(/punct/g, inline._punctuation)
    .getRegex();

  inline.emStrong.rDelimUnd = edit(inline.emStrong.rDelimUnd, 'gu')
    .replace(/punct/g, inline._punctuation)
    .getRegex();

  inline.anyPunctuation = edit(inline.anyPunctuation, 'gu')
    .replace(/punct/g, inline._punctuation)
    .getRegex();

  inline._escapes = edit(inline._escapes, 'gu')
    .replace(/punct/g, inline._punctuation)
    .getRegex();

  inline._scheme = /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/;
  inline._email = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/;
  inline.autolink = edit(inline.autolink)
    .replace('scheme', inline._scheme)
    .replace('email', inline._email)
    .getRegex();

  inline._attribute = /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/;

  inline.tag = edit(inline.tag)
    .replace('comment', inline._comment)
    .replace('attribute', inline._attribute)
    .getRegex();

  inline._label = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
  inline._href = /<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/;
  inline._title = /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/;

  inline.link = edit(inline.link)
    .replace('label', inline._label)
    .replace('href', inline._href)
    .replace('title', inline._title)
    .getRegex();

  inline.reflink = edit(inline.reflink)
    .replace('label', inline._label)
    .replace('ref', block._label)
    .getRegex();

  inline.nolink = edit(inline.nolink)
    .replace('ref', block._label)
    .getRegex();

  inline.reflinkSearch = edit(inline.reflinkSearch, 'g')
    .replace('reflink', inline.reflink)
    .replace('nolink', inline.nolink)
    .getRegex();

  /**
   * Normal Inline Grammar
   */

  inline.normal = { ...inline };

  /**
   * Pedantic Inline Grammar
   */

  inline.pedantic = {
    ...inline.normal,
    strong: {
      start: /^__|\*\*/,
      middle: /^__(?=\S)([\s\S]*?\S)__(?!_)|^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/,
      endAst: /\*\*(?!\*)/g,
      endUnd: /__(?!_)/g
    },
    em: {
      start: /^_|\*/,
      middle: /^()\*(?=\S)([\s\S]*?\S)\*(?!\*)|^_(?=\S)([\s\S]*?\S)_(?!_)/,
      endAst: /\*(?!\*)/g,
      endUnd: /_(?!_)/g
    },
    link: edit(/^!?\[(label)\]\((.*?)\)/)
      .replace('label', inline._label)
      .getRegex(),
    reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/)
      .replace('label', inline._label)
      .getRegex()
  };

  /**
   * GFM Inline Grammar
   */

  inline.gfm = {
    ...inline.normal,
    escape: edit(inline.escape).replace('])', '~|])').getRegex(),
    _extended_email: /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/,
    url: /^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,
    _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
    del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/,
    text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/
  };

  inline.gfm.url = edit(inline.gfm.url, 'i')
    .replace('email', inline.gfm._extended_email)
    .getRegex();
  /**
   * GFM + Line Breaks Inline Grammar
   */

  inline.breaks = {
    ...inline.gfm,
    br: edit(inline.br).replace('{2,}', '*').getRegex(),
    text: edit(inline.gfm.text)
      .replace('\\b_', '\\b_| {2,}\\n')
      .replace(/\{2,\}/g, '*')
      .getRegex()
  };

  /**
   * smartypants text replacement
   * @param {string} text
   */
  function smartypants(text) {
    return text
      // em-dashes
      .replace(/---/g, '\u2014')
      // en-dashes
      .replace(/--/g, '\u2013')
      // opening singles
      .replace(/(^|[-\u2014/(\[{"\s])'/g, '$1\u2018')
      // closing singles & apostrophes
      .replace(/'/g, '\u2019')
      // opening doubles
      .replace(/(^|[-\u2014/(\[{\u2018\s])"/g, '$1\u201c')
      // closing doubles
      .replace(/"/g, '\u201d')
      // ellipses
      .replace(/\.{3}/g, '\u2026');
  }

  /**
   * mangle email addresses
   * @param {string} text
   */
  function mangle(text) {
    let out = '',
      i,
      ch;

    const l = text.length;
    for (i = 0; i < l; i++) {
      ch = text.charCodeAt(i);
      if (Math.random() > 0.5) {
        ch = 'x' + ch.toString(16);
      }
      out += '&#' + ch + ';';
    }

    return out;
  }

  /**
   * Block Lexer
   */
  class Lexer {
    constructor(options) {
      this.tokens = [];
      this.tokens.links = Object.create(null);
      this.options = options || defaults;
      this.options.tokenizer = this.options.tokenizer || new Tokenizer();
      this.tokenizer = this.options.tokenizer;
      this.tokenizer.options = this.options;
      this.tokenizer.lexer = this;
      this.inlineQueue = [];
      this.state = {
        inLink: false,
        inRawBlock: false,
        top: true
      };

      const rules = {
        block: block.normal,
        inline: inline.normal
      };

      if (this.options.pedantic) {
        rules.block = block.pedantic;
        rules.inline = inline.pedantic;
      } else if (this.options.gfm) {
        rules.block = block.gfm;
        if (this.options.breaks) {
          rules.inline = inline.breaks;
        } else {
          rules.inline = inline.gfm;
        }
      }
      this.tokenizer.rules = rules;
    }

    /**
     * Expose Rules
     */
    static get rules() {
      return {
        block,
        inline
      };
    }

    /**
     * Static Lex Method
     */
    static lex(src, options) {
      const lexer = new Lexer(options);
      return lexer.lex(src);
    }

    /**
     * Static Lex Inline Method
     */
    static lexInline(src, options) {
      const lexer = new Lexer(options);
      return lexer.inlineTokens(src);
    }

    /**
     * Preprocessing
     */
    lex(src) {
      src = src
        .replace(/\r\n|\r/g, '\n');

      this.blockTokens(src, this.tokens);

      let next;
      while (next = this.inlineQueue.shift()) {
        this.inlineTokens(next.src, next.tokens);
      }

      return this.tokens;
    }

    /**
     * Lexing
     */
    blockTokens(src, tokens = []) {
      if (this.options.pedantic) {
        src = src.replace(/\t/g, '    ').replace(/^ +$/gm, '');
      } else {
        src = src.replace(/^( *)(\t+)/gm, (_, leading, tabs) => {
          return leading + '    '.repeat(tabs.length);
        });
      }

      let token, lastToken, cutSrc, lastParagraphClipped;

      while (src) {
        if (this.options.extensions
          && this.options.extensions.block
          && this.options.extensions.block.some((extTokenizer) => {
            if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
              src = src.substring(token.raw.length);
              tokens.push(token);
              return true;
            }
            return false;
          })) {
          continue;
        }

        // newline
        if (token = this.tokenizer.space(src)) {
          src = src.substring(token.raw.length);
          if (token.raw.length === 1 && tokens.length > 0) {
            // if there's a single \n as a spacer, it's terminating the last line,
            // so move it there so that we don't get unecessary paragraph tags
            tokens[tokens.length - 1].raw += '\n';
          } else {
            tokens.push(token);
          }
          continue;
        }

        // code
        if (token = this.tokenizer.code(src)) {
          src = src.substring(token.raw.length);
          lastToken = tokens[tokens.length - 1];
          // An indented code block cannot interrupt a paragraph.
          if (lastToken && (lastToken.type === 'paragraph' || lastToken.type === 'text')) {
            lastToken.raw += '\n' + token.raw;
            lastToken.text += '\n' + token.text;
            this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
          } else {
            tokens.push(token);
          }
          continue;
        }

        // fences
        if (token = this.tokenizer.fences(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // heading
        if (token = this.tokenizer.heading(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // hr
        if (token = this.tokenizer.hr(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // blockquote
        if (token = this.tokenizer.blockquote(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // list
        if (token = this.tokenizer.list(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // html
        if (token = this.tokenizer.html(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // def
        if (token = this.tokenizer.def(src)) {
          src = src.substring(token.raw.length);
          lastToken = tokens[tokens.length - 1];
          if (lastToken && (lastToken.type === 'paragraph' || lastToken.type === 'text')) {
            lastToken.raw += '\n' + token.raw;
            lastToken.text += '\n' + token.raw;
            this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
          } else if (!this.tokens.links[token.tag]) {
            this.tokens.links[token.tag] = {
              href: token.href,
              title: token.title
            };
          }
          continue;
        }

        // table (gfm)
        if (token = this.tokenizer.table(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // lheading
        if (token = this.tokenizer.lheading(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // top-level paragraph
        // prevent paragraph consuming extensions by clipping 'src' to extension start
        cutSrc = src;
        if (this.options.extensions && this.options.extensions.startBlock) {
          let startIndex = Infinity;
          const tempSrc = src.slice(1);
          let tempStart;
          this.options.extensions.startBlock.forEach(function(getStartIndex) {
            tempStart = getStartIndex.call({ lexer: this }, tempSrc);
            if (typeof tempStart === 'number' && tempStart >= 0) { startIndex = Math.min(startIndex, tempStart); }
          });
          if (startIndex < Infinity && startIndex >= 0) {
            cutSrc = src.substring(0, startIndex + 1);
          }
        }
        if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
          lastToken = tokens[tokens.length - 1];
          if (lastParagraphClipped && lastToken.type === 'paragraph') {
            lastToken.raw += '\n' + token.raw;
            lastToken.text += '\n' + token.text;
            this.inlineQueue.pop();
            this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
          } else {
            tokens.push(token);
          }
          lastParagraphClipped = (cutSrc.length !== src.length);
          src = src.substring(token.raw.length);
          continue;
        }

        // text
        if (token = this.tokenizer.text(src)) {
          src = src.substring(token.raw.length);
          lastToken = tokens[tokens.length - 1];
          if (lastToken && lastToken.type === 'text') {
            lastToken.raw += '\n' + token.raw;
            lastToken.text += '\n' + token.text;
            this.inlineQueue.pop();
            this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
          } else {
            tokens.push(token);
          }
          continue;
        }

        if (src) {
          const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
          if (this.options.silent) {
            console.error(errMsg);
            break;
          } else {
            throw new Error(errMsg);
          }
        }
      }

      this.state.top = true;
      return tokens;
    }

    inline(src, tokens = []) {
      this.inlineQueue.push({ src, tokens });
      return tokens;
    }

    /**
     * Lexing/Compiling
     */
    inlineTokens(src, tokens = []) {
      let token, lastToken, cutSrc;

      // String with links masked to avoid interference with em and strong
      let maskedSrc = src;
      let match;
      let keepPrevChar, prevChar;

      // Mask out reflinks
      if (this.tokens.links) {
        const links = Object.keys(this.tokens.links);
        if (links.length > 0) {
          while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
            if (links.includes(match[0].slice(match[0].lastIndexOf('[') + 1, -1))) {
              maskedSrc = maskedSrc.slice(0, match.index) + '[' + 'a'.repeat(match[0].length - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
            }
          }
        }
      }
      // Mask out other blocks
      while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
        maskedSrc = maskedSrc.slice(0, match.index) + '[' + 'a'.repeat(match[0].length - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
      }

      // Mask out escaped characters
      while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
        maskedSrc = maskedSrc.slice(0, match.index) + '++' + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
      }

      while (src) {
        if (!keepPrevChar) {
          prevChar = '';
        }
        keepPrevChar = false;

        // extensions
        if (this.options.extensions
          && this.options.extensions.inline
          && this.options.extensions.inline.some((extTokenizer) => {
            if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
              src = src.substring(token.raw.length);
              tokens.push(token);
              return true;
            }
            return false;
          })) {
          continue;
        }

        // escape
        if (token = this.tokenizer.escape(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // tag
        if (token = this.tokenizer.tag(src)) {
          src = src.substring(token.raw.length);
          lastToken = tokens[tokens.length - 1];
          if (lastToken && token.type === 'text' && lastToken.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }

        // link
        if (token = this.tokenizer.link(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // reflink, nolink
        if (token = this.tokenizer.reflink(src, this.tokens.links)) {
          src = src.substring(token.raw.length);
          lastToken = tokens[tokens.length - 1];
          if (lastToken && token.type === 'text' && lastToken.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }

        // em & strong
        if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // code
        if (token = this.tokenizer.codespan(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // br
        if (token = this.tokenizer.br(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // del (gfm)
        if (token = this.tokenizer.del(src)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // autolink
        if (token = this.tokenizer.autolink(src, mangle)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // url (gfm)
        if (!this.state.inLink && (token = this.tokenizer.url(src, mangle))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }

        // text
        // prevent inlineText consuming extensions by clipping 'src' to extension start
        cutSrc = src;
        if (this.options.extensions && this.options.extensions.startInline) {
          let startIndex = Infinity;
          const tempSrc = src.slice(1);
          let tempStart;
          this.options.extensions.startInline.forEach(function(getStartIndex) {
            tempStart = getStartIndex.call({ lexer: this }, tempSrc);
            if (typeof tempStart === 'number' && tempStart >= 0) { startIndex = Math.min(startIndex, tempStart); }
          });
          if (startIndex < Infinity && startIndex >= 0) {
            cutSrc = src.substring(0, startIndex + 1);
          }
        }
        if (token = this.tokenizer.inlineText(cutSrc, smartypants)) {
          src = src.substring(token.raw.length);
          if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
            prevChar = token.raw.slice(-1);
          }
          keepPrevChar = true;
          lastToken = tokens[tokens.length - 1];
          if (lastToken && lastToken.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }

        if (src) {
          const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
          if (this.options.silent) {
            console.error(errMsg);
            break;
          } else {
            throw new Error(errMsg);
          }
        }
      }

      return tokens;
    }
  }

  /**
   * Renderer
   */
  class Renderer {
    constructor(options) {
      this.options = options || defaults;
    }

    code(code, infostring, escaped) {
      const lang = (infostring || '').match(/\S*/)[0];
      if (this.options.highlight) {
        const out = this.options.highlight(code, lang);
        if (out != null && out !== code) {
          escaped = true;
          code = out;
        }
      }

      code = code.replace(/\n$/, '') + '\n';

      if (!lang) {
        return '<pre><code>'
          + (escaped ? code : escape(code, true))
          + '</code></pre>\n';
      }

      return '<pre><code class="'
        + this.options.langPrefix
        + escape(lang)
        + '">'
        + (escaped ? code : escape(code, true))
        + '</code></pre>\n';
    }

    /**
     * @param {string} quote
     */
    blockquote(quote) {
      return `<blockquote>\n${quote}</blockquote>\n`;
    }

    html(html, block) {
      return html;
    }

    /**
     * @param {string} text
     * @param {string} level
     * @param {string} raw
     * @param {any} slugger
     */
    heading(text, level, raw, slugger) {
      if (this.options.headerIds) {
        const id = this.options.headerPrefix + slugger.slug(raw);
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      }

      // ignore IDs
      return `<h${level}>${text}</h${level}>\n`;
    }

    hr() {
      return this.options.xhtml ? '<hr/>\n' : '<hr>\n';
    }

    list(body, ordered, start) {
      const type = ordered ? 'ol' : 'ul',
        startatt = (ordered && start !== 1) ? (' start="' + start + '"') : '';
      return '<' + type + startatt + '>\n' + body + '</' + type + '>\n';
    }

    /**
     * @param {string} text
     */
    listitem(text) {
      return `<li>${text}</li>\n`;
    }

    checkbox(checked) {
      return '<input '
        + (checked ? 'checked="" ' : '')
        + 'disabled="" type="checkbox"'
        + (this.options.xhtml ? ' /' : '')
        + '> ';
    }

    /**
     * @param {string} text
     */
    paragraph(text) {
      return `<p>${text}</p>\n`;
    }

    /**
     * @param {string} header
     * @param {string} body
     */
    table(header, body) {
      if (body) body = `<tbody>${body}</tbody>`;

      return '<table>\n'
        + '<thead>\n'
        + header
        + '</thead>\n'
        + body
        + '</table>\n';
    }

    /**
     * @param {string} content
     */
    tablerow(content) {
      return `<tr>\n${content}</tr>\n`;
    }

    tablecell(content, flags) {
      const type = flags.header ? 'th' : 'td';
      const tag = flags.align
        ? `<${type} align="${flags.align}">`
        : `<${type}>`;
      return tag + content + `</${type}>\n`;
    }

    /**
     * span level renderer
     * @param {string} text
     */
    strong(text) {
      return `<strong>${text}</strong>`;
    }

    /**
     * @param {string} text
     */
    em(text) {
      return `<em>${text}</em>`;
    }

    /**
     * @param {string} text
     */
    codespan(text) {
      return `<code>${text}</code>`;
    }

    br() {
      return this.options.xhtml ? '<br/>' : '<br>';
    }

    /**
     * @param {string} text
     */
    del(text) {
      return `<del>${text}</del>`;
    }

    /**
     * @param {string} href
     * @param {string} title
     * @param {string} text
     */
    link(href, title, text) {
      href = cleanUrl(this.options.sanitize, this.options.baseUrl, href);
      if (href === null) {
        return text;
      }
      let out = '<a href="' + href + '"';
      if (title) {
        out += ' title="' + title + '"';
      }
      out += '>' + text + '</a>';
      return out;
    }

    /**
     * @param {string} href
     * @param {string} title
     * @param {string} text
     */
    image(href, title, text) {
      href = cleanUrl(this.options.sanitize, this.options.baseUrl, href);
      if (href === null) {
        return text;
      }

      let out = `<img src="${href}" alt="${text}"`;
      if (title) {
        out += ` title="${title}"`;
      }
      out += this.options.xhtml ? '/>' : '>';
      return out;
    }

    text(text) {
      return text;
    }
  }

  /**
   * TextRenderer
   * returns only the textual part of the token
   */
  class TextRenderer {
    // no need for block level renderers
    strong(text) {
      return text;
    }

    em(text) {
      return text;
    }

    codespan(text) {
      return text;
    }

    del(text) {
      return text;
    }

    html(text) {
      return text;
    }

    text(text) {
      return text;
    }

    link(href, title, text) {
      return '' + text;
    }

    image(href, title, text) {
      return '' + text;
    }

    br() {
      return '';
    }
  }

  /**
   * Slugger generates header id
   */
  class Slugger {
    constructor() {
      this.seen = {};
    }

    /**
     * @param {string} value
     */
    serialize(value) {
      return value
        .toLowerCase()
        .trim()
        // remove html tags
        .replace(/<[!\/a-z].*?>/ig, '')
        // remove unwanted chars
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
        .replace(/\s/g, '-');
    }

    /**
     * Finds the next safe (unique) slug to use
     * @param {string} originalSlug
     * @param {boolean} isDryRun
     */
    getNextSafeSlug(originalSlug, isDryRun) {
      let slug = originalSlug;
      let occurenceAccumulator = 0;
      if (this.seen.hasOwnProperty(slug)) {
        occurenceAccumulator = this.seen[originalSlug];
        do {
          occurenceAccumulator++;
          slug = originalSlug + '-' + occurenceAccumulator;
        } while (this.seen.hasOwnProperty(slug));
      }
      if (!isDryRun) {
        this.seen[originalSlug] = occurenceAccumulator;
        this.seen[slug] = 0;
      }
      return slug;
    }

    /**
     * Convert string to unique id
     * @param {object} [options]
     * @param {boolean} [options.dryrun] Generates the next unique slug without
     * updating the internal accumulator.
     */
    slug(value, options = {}) {
      const slug = this.serialize(value);
      return this.getNextSafeSlug(slug, options.dryrun);
    }
  }

  /**
   * Parsing & Compiling
   */
  class Parser {
    constructor(options) {
      this.options = options || defaults;
      this.options.renderer = this.options.renderer || new Renderer();
      this.renderer = this.options.renderer;
      this.renderer.options = this.options;
      this.textRenderer = new TextRenderer();
      this.slugger = new Slugger();
    }

    /**
     * Static Parse Method
     */
    static parse(tokens, options) {
      const parser = new Parser(options);
      return parser.parse(tokens);
    }

    /**
     * Static Parse Inline Method
     */
    static parseInline(tokens, options) {
      const parser = new Parser(options);
      return parser.parseInline(tokens);
    }

    /**
     * Parse Loop
     */
    parse(tokens, top = true) {
      let out = '',
        i,
        j,
        k,
        l2,
        l3,
        row,
        cell,
        header,
        body,
        token,
        ordered,
        start,
        loose,
        itemBody,
        item,
        checked,
        task,
        checkbox,
        ret;

      const l = tokens.length;
      for (i = 0; i < l; i++) {
        token = tokens[i];

        // Run any renderer extensions
        if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[token.type]) {
          ret = this.options.extensions.renderers[token.type].call({ parser: this }, token);
          if (ret !== false || !['space', 'hr', 'heading', 'code', 'table', 'blockquote', 'list', 'html', 'paragraph', 'text'].includes(token.type)) {
            out += ret || '';
            continue;
          }
        }

        switch (token.type) {
          case 'space': {
            continue;
          }
          case 'hr': {
            out += this.renderer.hr();
            continue;
          }
          case 'heading': {
            out += this.renderer.heading(
              this.parseInline(token.tokens),
              token.depth,
              unescape(this.parseInline(token.tokens, this.textRenderer)),
              this.slugger);
            continue;
          }
          case 'code': {
            out += this.renderer.code(token.text,
              token.lang,
              token.escaped);
            continue;
          }
          case 'table': {
            header = '';

            // header
            cell = '';
            l2 = token.header.length;
            for (j = 0; j < l2; j++) {
              cell += this.renderer.tablecell(
                this.parseInline(token.header[j].tokens),
                { header: true, align: token.align[j] }
              );
            }
            header += this.renderer.tablerow(cell);

            body = '';
            l2 = token.rows.length;
            for (j = 0; j < l2; j++) {
              row = token.rows[j];

              cell = '';
              l3 = row.length;
              for (k = 0; k < l3; k++) {
                cell += this.renderer.tablecell(
                  this.parseInline(row[k].tokens),
                  { header: false, align: token.align[k] }
                );
              }

              body += this.renderer.tablerow(cell);
            }
            out += this.renderer.table(header, body);
            continue;
          }
          case 'blockquote': {
            body = this.parse(token.tokens);
            out += this.renderer.blockquote(body);
            continue;
          }
          case 'list': {
            ordered = token.ordered;
            start = token.start;
            loose = token.loose;
            l2 = token.items.length;

            body = '';
            for (j = 0; j < l2; j++) {
              item = token.items[j];
              checked = item.checked;
              task = item.task;

              itemBody = '';
              if (item.task) {
                checkbox = this.renderer.checkbox(checked);
                if (loose) {
                  if (item.tokens.length > 0 && item.tokens[0].type === 'paragraph') {
                    item.tokens[0].text = checkbox + ' ' + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
                      item.tokens[0].tokens[0].text = checkbox + ' ' + item.tokens[0].tokens[0].text;
                    }
                  } else {
                    item.tokens.unshift({
                      type: 'text',
                      text: checkbox
                    });
                  }
                } else {
                  itemBody += checkbox;
                }
              }

              itemBody += this.parse(item.tokens, loose);
              body += this.renderer.listitem(itemBody, task, checked);
            }

            out += this.renderer.list(body, ordered, start);
            continue;
          }
          case 'html': {
            out += this.renderer.html(token.text, token.block);
            continue;
          }
          case 'paragraph': {
            out += this.renderer.paragraph(this.parseInline(token.tokens));
            continue;
          }
          case 'text': {
            body = token.tokens ? this.parseInline(token.tokens) : token.text;
            while (i + 1 < l && tokens[i + 1].type === 'text') {
              token = tokens[++i];
              body += '\n' + (token.tokens ? this.parseInline(token.tokens) : token.text);
            }
            out += top ? this.renderer.paragraph(body) : body;
            continue;
          }

          default: {
            const errMsg = 'Token with "' + token.type + '" type was not found.';
            if (this.options.silent) {
              console.error(errMsg);
              return;
            } else {
              throw new Error(errMsg);
            }
          }
        }
      }

      return out;
    }

    /**
     * Parse Inline Tokens
     */
    parseInline(tokens, renderer) {
      renderer = renderer || this.renderer;
      let out = '',
        i,
        token,
        ret;

      const l = tokens.length;
      for (i = 0; i < l; i++) {
        token = tokens[i];

        // Run any renderer extensions
        if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[token.type]) {
          ret = this.options.extensions.renderers[token.type].call({ parser: this }, token);
          if (ret !== false || !['escape', 'html', 'link', 'image', 'strong', 'em', 'codespan', 'br', 'del', 'text'].includes(token.type)) {
            out += ret || '';
            continue;
          }
        }

        switch (token.type) {
          case 'escape': {
            out += renderer.text(token.text);
            break;
          }
          case 'html': {
            out += renderer.html(token.text);
            break;
          }
          case 'link': {
            out += renderer.link(token.href, token.title, this.parseInline(token.tokens, renderer));
            break;
          }
          case 'image': {
            out += renderer.image(token.href, token.title, token.text);
            break;
          }
          case 'strong': {
            out += renderer.strong(this.parseInline(token.tokens, renderer));
            break;
          }
          case 'em': {
            out += renderer.em(this.parseInline(token.tokens, renderer));
            break;
          }
          case 'codespan': {
            out += renderer.codespan(token.text);
            break;
          }
          case 'br': {
            out += renderer.br();
            break;
          }
          case 'del': {
            out += renderer.del(this.parseInline(token.tokens, renderer));
            break;
          }
          case 'text': {
            out += renderer.text(token.text);
            break;
          }
          default: {
            const errMsg = 'Token with "' + token.type + '" type was not found.';
            if (this.options.silent) {
              console.error(errMsg);
              return;
            } else {
              throw new Error(errMsg);
            }
          }
        }
      }
      return out;
    }
  }

  class Hooks {
    constructor(options) {
      this.options = options || defaults;
    }

    static passThroughHooks = new Set([
      'preprocess',
      'postprocess'
    ]);

    /**
     * Process markdown before marked
     */
    preprocess(markdown) {
      return markdown;
    }

    /**
     * Process HTML after marked is finished
     */
    postprocess(html) {
      return html;
    }
  }

  class Marked {
    defaults = getDefaults();
    options = this.setOptions;

    parse = this.#parseMarkdown(Lexer.lex, Parser.parse);
    parseInline = this.#parseMarkdown(Lexer.lexInline, Parser.parseInline);

    Parser = Parser;
    parser = Parser.parse;
    Renderer = Renderer;
    TextRenderer = TextRenderer;
    Lexer = Lexer;
    lexer = Lexer.lex;
    Tokenizer = Tokenizer;
    Slugger = Slugger;
    Hooks = Hooks;

    constructor(...args) {
      this.use(...args);
    }

    walkTokens(tokens, callback) {
      let values = [];
      for (const token of tokens) {
        values = values.concat(callback.call(this, token));
        switch (token.type) {
          case 'table': {
            for (const cell of token.header) {
              values = values.concat(this.walkTokens(cell.tokens, callback));
            }
            for (const row of token.rows) {
              for (const cell of row) {
                values = values.concat(this.walkTokens(cell.tokens, callback));
              }
            }
            break;
          }
          case 'list': {
            values = values.concat(this.walkTokens(token.items, callback));
            break;
          }
          default: {
            if (this.defaults.extensions && this.defaults.extensions.childTokens && this.defaults.extensions.childTokens[token.type]) { // Walk any extensions
              this.defaults.extensions.childTokens[token.type].forEach((childTokens) => {
                values = values.concat(this.walkTokens(token[childTokens], callback));
              });
            } else if (token.tokens) {
              values = values.concat(this.walkTokens(token.tokens, callback));
            }
          }
        }
      }
      return values;
    }

    use(...args) {
      const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };

      args.forEach((pack) => {
        // copy options to new object
        const opts = { ...pack };

        // set async to true if it was set to true before
        opts.async = this.defaults.async || opts.async || false;

        // ==-- Parse "addon" extensions --== //
        if (pack.extensions) {
          pack.extensions.forEach((ext) => {
            if (!ext.name) {
              throw new Error('extension name required');
            }
            if (ext.renderer) { // Renderer extensions
              const prevRenderer = extensions.renderers[ext.name];
              if (prevRenderer) {
                // Replace extension with func to run new extension but fall back if false
                extensions.renderers[ext.name] = function(...args) {
                  let ret = ext.renderer.apply(this, args);
                  if (ret === false) {
                    ret = prevRenderer.apply(this, args);
                  }
                  return ret;
                };
              } else {
                extensions.renderers[ext.name] = ext.renderer;
              }
            }
            if (ext.tokenizer) { // Tokenizer Extensions
              if (!ext.level || (ext.level !== 'block' && ext.level !== 'inline')) {
                throw new Error("extension level must be 'block' or 'inline'");
              }
              if (extensions[ext.level]) {
                extensions[ext.level].unshift(ext.tokenizer);
              } else {
                extensions[ext.level] = [ext.tokenizer];
              }
              if (ext.start) { // Function to check for start of token
                if (ext.level === 'block') {
                  if (extensions.startBlock) {
                    extensions.startBlock.push(ext.start);
                  } else {
                    extensions.startBlock = [ext.start];
                  }
                } else if (ext.level === 'inline') {
                  if (extensions.startInline) {
                    extensions.startInline.push(ext.start);
                  } else {
                    extensions.startInline = [ext.start];
                  }
                }
              }
            }
            if (ext.childTokens) { // Child tokens to be visited by walkTokens
              extensions.childTokens[ext.name] = ext.childTokens;
            }
          });
          opts.extensions = extensions;
        }

        // ==-- Parse "overwrite" extensions --== //
        if (pack.renderer) {
          const renderer = this.defaults.renderer || new Renderer(this.defaults);
          for (const prop in pack.renderer) {
            const prevRenderer = renderer[prop];
            // Replace renderer with func to run extension, but fall back if false
            renderer[prop] = (...args) => {
              let ret = pack.renderer[prop].apply(renderer, args);
              if (ret === false) {
                ret = prevRenderer.apply(renderer, args);
              }
              return ret;
            };
          }
          opts.renderer = renderer;
        }
        if (pack.tokenizer) {
          const tokenizer = this.defaults.tokenizer || new Tokenizer(this.defaults);
          for (const prop in pack.tokenizer) {
            const prevTokenizer = tokenizer[prop];
            // Replace tokenizer with func to run extension, but fall back if false
            tokenizer[prop] = (...args) => {
              let ret = pack.tokenizer[prop].apply(tokenizer, args);
              if (ret === false) {
                ret = prevTokenizer.apply(tokenizer, args);
              }
              return ret;
            };
          }
          opts.tokenizer = tokenizer;
        }

        // ==-- Parse Hooks extensions --== //
        if (pack.hooks) {
          const hooks = this.defaults.hooks || new Hooks();
          for (const prop in pack.hooks) {
            const prevHook = hooks[prop];
            if (Hooks.passThroughHooks.has(prop)) {
              hooks[prop] = (arg) => {
                if (this.defaults.async) {
                  return Promise.resolve(pack.hooks[prop].call(hooks, arg)).then(ret => {
                    return prevHook.call(hooks, ret);
                  });
                }

                const ret = pack.hooks[prop].call(hooks, arg);
                return prevHook.call(hooks, ret);
              };
            } else {
              hooks[prop] = (...args) => {
                let ret = pack.hooks[prop].apply(hooks, args);
                if (ret === false) {
                  ret = prevHook.apply(hooks, args);
                }
                return ret;
              };
            }
          }
          opts.hooks = hooks;
        }

        // ==-- Parse WalkTokens extensions --== //
        if (pack.walkTokens) {
          const walkTokens = this.defaults.walkTokens;
          opts.walkTokens = function(token) {
            let values = [];
            values.push(pack.walkTokens.call(this, token));
            if (walkTokens) {
              values = values.concat(walkTokens.call(this, token));
            }
            return values;
          };
        }

        this.defaults = { ...this.defaults, ...opts };
      });

      return this;
    }

    setOptions(opt) {
      this.defaults = { ...this.defaults, ...opt };
      return this;
    }

    #parseMarkdown(lexer, parser) {
      return (src, opt, callback) => {
        if (typeof opt === 'function') {
          callback = opt;
          opt = null;
        }

        const origOpt = { ...opt };
        opt = { ...this.defaults, ...origOpt };
        const throwError = this.#onError(opt.silent, opt.async, callback);

        // throw error in case of non string input
        if (typeof src === 'undefined' || src === null) {
          return throwError(new Error('marked(): input parameter is undefined or null'));
        }
        if (typeof src !== 'string') {
          return throwError(new Error('marked(): input parameter is of type '
            + Object.prototype.toString.call(src) + ', string expected'));
        }

        checkDeprecations(opt, callback);

        if (opt.hooks) {
          opt.hooks.options = opt;
        }

        if (callback) {
          const highlight = opt.highlight;
          let tokens;

          try {
            if (opt.hooks) {
              src = opt.hooks.preprocess(src);
            }
            tokens = lexer(src, opt);
          } catch (e) {
            return throwError(e);
          }

          const done = (err) => {
            let out;

            if (!err) {
              try {
                if (opt.walkTokens) {
                  this.walkTokens(tokens, opt.walkTokens);
                }
                out = parser(tokens, opt);
                if (opt.hooks) {
                  out = opt.hooks.postprocess(out);
                }
              } catch (e) {
                err = e;
              }
            }

            opt.highlight = highlight;

            return err
              ? throwError(err)
              : callback(null, out);
          };

          if (!highlight || highlight.length < 3) {
            return done();
          }

          delete opt.highlight;

          if (!tokens.length) return done();

          let pending = 0;
          this.walkTokens(tokens, (token) => {
            if (token.type === 'code') {
              pending++;
              setTimeout(() => {
                highlight(token.text, token.lang, (err, code) => {
                  if (err) {
                    return done(err);
                  }
                  if (code != null && code !== token.text) {
                    token.text = code;
                    token.escaped = true;
                  }

                  pending--;
                  if (pending === 0) {
                    done();
                  }
                });
              }, 0);
            }
          });

          if (pending === 0) {
            done();
          }

          return;
        }

        if (opt.async) {
          return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src)
            .then(src => lexer(src, opt))
            .then(tokens => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens)
            .then(tokens => parser(tokens, opt))
            .then(html => opt.hooks ? opt.hooks.postprocess(html) : html)
            .catch(throwError);
        }

        try {
          if (opt.hooks) {
            src = opt.hooks.preprocess(src);
          }
          const tokens = lexer(src, opt);
          if (opt.walkTokens) {
            this.walkTokens(tokens, opt.walkTokens);
          }
          let html = parser(tokens, opt);
          if (opt.hooks) {
            html = opt.hooks.postprocess(html);
          }
          return html;
        } catch (e) {
          return throwError(e);
        }
      };
    }

    #onError(silent, async, callback) {
      return (e) => {
        e.message += '\nPlease report this to https://github.com/markedjs/marked.';

        if (silent) {
          const msg = '<p>An error occurred:</p><pre>'
            + escape(e.message + '', true)
            + '</pre>';
          if (async) {
            return Promise.resolve(msg);
          }
          if (callback) {
            callback(null, msg);
            return;
          }
          return msg;
        }

        if (async) {
          return Promise.reject(e);
        }
        if (callback) {
          callback(e);
          return;
        }
        throw e;
      };
    }
  }

  const markedInstance = new Marked(defaults);

  /**
   * Marked
   */
  function marked(src, opt, callback) {
    return markedInstance.parse(src, opt, callback);
  }

  /**
   * Options
   */

  marked.options =
  marked.setOptions = function(opt) {
    markedInstance.setOptions(opt);
    marked.defaults = markedInstance.defaults;
    changeDefaults(marked.defaults);
    return marked;
  };

  marked.getDefaults = getDefaults;

  marked.defaults = defaults;

  /**
   * Use Extension
   */

  marked.use = function(...args) {
    markedInstance.use(...args);
    marked.defaults = markedInstance.defaults;
    changeDefaults(marked.defaults);
    return marked;
  };

  /**
   * Run callback for every token
   */

  marked.walkTokens = function(tokens, callback) {
    return markedInstance.walkTokens(tokens, callback);
  };

  /**
   * Parse Inline
   * @param {string} src
   */
  marked.parseInline = markedInstance.parseInline;

  /**
   * Expose
   */
  marked.Parser = Parser;
  marked.parser = Parser.parse;
  marked.Renderer = Renderer;
  marked.TextRenderer = TextRenderer;
  marked.Lexer = Lexer;
  marked.lexer = Lexer.lex;
  marked.Tokenizer = Tokenizer;
  marked.Slugger = Slugger;
  marked.Hooks = Hooks;
  marked.parse = marked;

  marked.options;
  marked.setOptions;
  marked.use;
  marked.walkTokens;
  marked.parseInline;
  Parser.parse;
  Lexer.lex;

  class Book extends DivComponent {
    constructor(appState, bookState) {
      super();
      this.appState = appState;
      this.bookState = bookState.bookInfoMore;
      const {
        bookInfoMore: { cover_edition_key },
        bookInfoMore: { author_name },
        bookInfoMore: { subject_key },
        bookInfoMore: { first_publish_year },
        bookInfoMore: { number_of_pages_median },

        bookInfo: { description },
        bookInfo: { subjects },
      } = bookState;

      this.cover = cover_edition_key;
      this.author = author_name ? author_name[0] : ' ';
      this.сategory = subject_key ? subject_key[0] : ' ';
      this.firstPublishYear = first_publish_year ? first_publish_year : ' ';
      this.pages = number_of_pages_median ? number_of_pages_median : ' ';
      this.description = description;
      this.subjects = subjects ? subjects.slice(0, 12) : ' ';
    }

    #addToFavorite() {
      this.appState.favorites.push(this.bookState);
    }

    #deleteFromFavorite() {
      this.appState.favorites = this.appState.favorites.filter(
        (b) => b.key !== this.bookState.key
      );
    }

    render() {
      this.el.classList.add('book');
      const existInFavorites = this.appState.favorites.find(
        (b) => b.key === this.bookState.key
      );
      this.el.innerHTML = `
      <div class="book__header">
        <div class="book__image">
          <img src="https://covers.openlibrary.org/b/olid/${
            this.cover
          }-M.jpg" alt="Обложка" />
        </div>
        <div class="book__about">
          <p class="book__author"><span>Автор</span>: ${this.author}</p>
          <p class="book__сategory"><span>Жанр</span>: ${this.сategory}</p>
          <p class="book__year"><span>Первая публикация</span>: ${
            this.firstPublishYear
          }</p>
          <p class="book__pages"><span>Число страниц</span>: ${this.pages}</p>
          <button class="book__btn-add ${existInFavorites ? 'book__btn-active' : ''}">
            В избранное
          </button>
        </div>
      </div>
      <div class="book__body">
        <p class="book__title"><span>Описание:</span></p>
        <p class="book__descr">${
          this.description
            ? typeof this.description === 'string'
              ? marked(this.description)
              : marked(this.description.value)
            : 'Описание отсутвует'
        }</p>
      </div>
      <div class="book__footer">
        <p class="book__title"><span>Теги:</span></p>
        <ul class="book__subjects">
          ${
            Array.isArray(this.subjects)
              ? this.subjects.map((subject) => `<li>${subject}</li>`).join('')
              : ' '
          }
        </ul>
      </div>
    `;

      if (existInFavorites) {
        this.el
          .querySelector('.book__btn-active')
          .addEventListener('click', this.#deleteFromFavorite.bind(this));
      } else {
        this.el
          .querySelector('.book__btn-add')
          .addEventListener('click', this.#addToFavorite.bind(this));
      }

      return this.el;
    }
  }

  class BookView extends AbstractView {
    state = {
      bookInfo: [],
      bookInfoMore: [],
      searchQuery: location.hash.split('/')[1],
    };

    constructor(appState) {
      super();
      this.appState = appState;
      this.loadBook = loadBook;
      this.loadList = loadList;
      this.appState = onChange(this.appState, this.appStateHook.bind(this));
    }

    destroy() {
      onChange.unsubscribe(this.appState);
    }

    appStateHook(path) {
      if (path === 'favorites') {
        this.render();
      }
    }

    async loadInfoBook() {
      this.state.bookInfo = await this.loadBook(this.state.searchQuery);
      const list = await this.loadList(this.state.bookInfo.title);
      this.state.bookInfoMore = list.docs.find((b) => b.key === this.state.bookInfo.key);
      this.setTitle(`${this.state.bookInfo.title}`);
    }

    async render() {
      await this.loadInfoBook();
      const main = document.createElement('div');
      main.innerHTML = `<h1>${this.state.bookInfo.title}</h1>`;
      main.append(new Book(this.appState, this.state).render());
      this.app.innerHTML = '';
      this.app.append(main);
      this.renderHeader();
    }

    renderHeader() {
      const header = new Header(this.appState).render();
      this.app.prepend(header);
    }
  }

  class PageNotFound extends AbstractView {
    constructor(appState) {
      super();
      this.appState = appState;
      this.setTitle('Страница не найдена');
    }

    render() {
      const main = document.createElement('div');
      main.innerHTML = `
      <h1>Страница не найдена</h1>
      <p class="page-not-found">Вернуться на <a href="#">главную страницу</a></p>
    `;
      this.app.innerHTML = '';
      this.app.append(main);
      this.renderHeader();
    }

    renderHeader() {
      const header = new Header(this.appState).render();
      this.app.prepend(header);
    }
  }

  // Импортируем компонент

  // Основной класс приложения
  class App {
    // Массив маршрутов
    routes = [
      { path: '', view: MainView },
      { path: '#favorites', view: FavoritesView },
      { path: '#books/:id', view: BookView },
    ];

    // Глобальный State для работы с Favorites
    appState = {
      favorites: [],
      list: [],
      numFound: 0,
    };

    constructor() {
      // Подписываемся на событие изменения URL-адреса
      window.addEventListener('hashchange', this.route.bind(this));

      // Вызываем маршрутизацию
      this.route();
    }

    // Метод для обработки маршрутов
    route() {
      // Если страница уже отрисована, вызываем метод destroy
      if (this.currentView) {
        this.currentView.destroy();
      }

      // Находим маршрут в массиве маршрутов по URL-адресу
      // const view = this.routes.find((r) => r.path === location.hash).view;

      try {
        // Находим маршрут в массиве маршрутов по URL-адресу
        const view = this.routes.find((route) => {
          // Разбиваем путь маршрута и URL-адрес на части
          const routeParts = route.path.split('/');
          const pathParts = location.hash.split('/');

          // Проверяем, что первая часть пути маршрута соответствует первой части URL-адреса
          const routeIsValid = routeParts[0] === pathParts[0];

          // Проверяем, что вторая часть URL-адреса соответствует шаблону
          // (два символа алфавита и четыре цифры)
          const pathIsValid = /^[A-Za-z]{2}\d{4}/.test(pathParts[1]);

          // Проверяем, что URL-адрес не состоит более чем из двух частей
          const pathIsNotTooLong = pathParts.length <= 2;

          // Если URL-адрес слишком длинный, выбрасываем исключение
          if (!pathIsNotTooLong) {
            throw new Error('Invalid path');
          }

          // Возвращаем результат, если путь маршрута и URL-адрес проходят проверку
          return routeIsValid && (pathParts.length === 1 || pathIsValid);
        }).view;

        // Создаём экземпляр класса для отрисовки страницы
        this.currentView = new view(this.appState);

        // Вызываем render, чтобы отрисовать страницу
        this.currentView.render();
      } catch (error) {
        // Если маршрут не найден, делаем редирект на главную страницу
        this.currentView = new PageNotFound(this.appState);
        this.currentView.render();
      }
    }
  }

  // Запускаем наше приложение
  new App();

})();
