/**
 * locationformer.js
 */

const util = require('util');

const utils = require('./utils');

module.exports = {
  start(plugin, params) {
    this.plugin = plugin;
    this.params = params;
  },

  async loadPlaces() {
    const places = await this.plugin.places.get();

    this.placesObj = {};
    places.forEach(item => {
      this.placesObj[item.id] = item.title;
    });
  },

  prepare(locationobj) {
    for (const prop in locationobj) {
      // Если в верхней папки (depth=0) нет устройств - ее нет - добавить
      if (!locationobj[prop][prop]) locationobj[prop][prop] = {};
      const locationArr = Object.keys(locationobj[prop]).sort();

      locationArr.forEach(locid => {
        const depth = this.getDepth(locid);
        locationobj[prop][locid].depth = depth;
        locationobj[prop][locid].nodeId = this.getNodeIdName(locid);
        locationobj[prop][locid].parentLocation = getParentLocation(locid);
        locationobj[prop][locid].name = this.getPlaceName(locid);

        if (depth > 1) {
          this.insertSkippedParent(locationobj, prop, locid);
        }
      });
    }
    
    return locationobj;
  },

  // Если есть пропущенные уровни - добавить папки без устройств 'dg003/dg030':{depth:2}
  insertSkippedParent(locationobj, prop, locid) {
    let depth = this.getDepth(locid);
    let xloc = locid;
    while (depth > 1) {
      const parentLocation = getParentLocation(xloc);
      depth = this.getDepth(parentLocation);
      if (!locationobj[prop][parentLocation]) {
       locationobj[prop][parentLocation] = this.getLocationItem(parentLocation);
      }
      xloc = parentLocation;
    }
  },

  getLocationItem(locid) {
    const depth = this.getDepth(locid);
    const name = this.getPlaceName(locid);
    const nodeId = this.getNodeIdName(locid);
    return { depth, parentLocation: getParentLocation(locid), name, nodeId };
  },

  getPlaceName(locid) {
    const id = utils.getLastPlace(locid);
    return id && this.placesObj[id] ? this.placesObj[id] : locid;
  },

  existsPlace(id) {
    return !!(id && this.placesObj[id]);
  },

  getNodeIdName(locid) {
    let strLocation = '';
    locid.split('/').forEach(item => {
      strLocation += this.placesObj[item] + '(' + item + ')/';
    });
    return strLocation.slice(0, -1);
  },

  getParentLocid(loc) {
    return loc ? getParentLocation(loc) : '';
  },

  getDepth(loc) {
    // dg002 => 0
    // dg002/dg022/dg222 => 2
    const arr = loc.split('/').filter(el => el);
    return arr.length - 1;
  }

};

function getParentLocation(loc) {
  // Вернуть без последнего элемента dg002/dg022/dg222 => dg002/dg022
  return loc
    .split('/')
    .filter(el => el)
    .slice(0, -1)
    .join('/');
}


