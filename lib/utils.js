/**
 * utils.js
 */
const util = require('util');

const { DataType } = require('node-opcua');

exports.groupBy = groupBy;
exports.getLastPlace = getLastPlace;
exports.getTailLocation = getTailLocation;
exports.getFolderForFilter = getFolderForFilter;
exports.getDataType = getDataType;
exports.getDevicesForExtra = getDevicesForExtra;

function groupBy(objectArray, property) {
  return objectArray.reduce((acc, obj) => {
    let key = obj[property];
    if (!acc[key]) {
      acc[key] = {};
      acc[key].ref = [];
      if (key == 'device') {
        acc[key].didarr = [];
      }
    }
    acc[key].ref.push(obj);
    if (key == 'device') {
      acc[key].didarr.push(obj.did);
    }
    return acc;
  }, {});
}

function getLastPlace(loc) {
  // Вернуть последний непустой элемент  /place/dg003/dg010/ => 'dg010'
  // Для '/place//' => 'place' (Все устройства)
  const arr = loc.split('/').filter(el => el); // убрать пустые эл-ты
  if (arr.length > 0) {
    const xitem = arr[arr.length - 1];
    return xitem;
  }
}

function getTailLocation(loc, xdg) {
  // Вернуть хвостик, включая xdg
  // xdg = 'dg010': '/place/dg003/dg010/'=> 'dg010'
  // xdg = 'dg003': '/place/dg003/dg010/'=> 'dg003/dg010'
  const arr = loc.split('/').filter(el => el);
  const idx = arr.findIndex(el => el == xdg);
  return idx >= 0 ? arr.splice(idx).join('/') : '';
}

function getFolderForFilter(fobj) {
  let key = '';
  if (fobj.filter == 'tag') key = fobj.tagStr;
  if (fobj.filter == 'device') key = 'Devices';
  if (fobj.filter == 'location') key = getLastPlace(fobj.locationStr);
  if (!key) throw 'No key for filter ' + util.inspect(fobj);
  return key;
}

function getDataType(vtype) {
  let dataType = {
    s:'String',
    obj:DataType.String
  };
  if (vtype == 'N') {
    dataType.s = 'Double';
    dataType.obj = DataType.Double;
  }
  if (vtype == 'B') {
    dataType.s = 'Boolean';
    dataType.obj = DataType.Boolean;
  }
  return dataType;
}

/**
 * Получение с сервера массивов устройств для фильтров
 *
 * @param {Array of objects} channels
 * @return {Object} res
 *      devicesobj - {Devices:[Массив устройств, для которых фильтр по device]}
 *      locationobj - {dg001:{dg001/dg042:[Массив устройств в папке]}, ...}
 *      tagobj - {VENT:[Массив устройств с меткой VENT], ...}}
 */
async function getDevicesForExtra(channels, plugin) {
  const groupchannels = groupBy(channels, 'filter');

  const res = { tagobj: {}, devicesobj: {}, locationobj: {} };

  for (const element in groupchannels) {
    if (element == 'device') {
      const did = groupchannels[element].didarr;
      const devices = await getDevicesByOneFilter({ did });
      res.devicesobj.Devices = devices;
    }

    if (element == 'tag') {
      for (let i = 0; i < groupchannels[element].ref.length; i++) {
        const tag = groupchannels[element].ref[i].tagStr;
        const devices = await getDevicesByOneFilter({ tag });
        res.tagobj[tag] = devices;
      }
    }

    if (element == 'location') {
      for (let i = 0; i < groupchannels[element].ref.length; i++) {
        const location = groupchannels[element].ref[i].locationStr;
        const devices = await getDevicesByOneFilter({ location });
    
        const locStart = getLastPlace(location);
        devices.forEach(item => {
          item.locid = locStart == item.parent ? item.parent : getTailLocation(item.location, locStart);
        });

        const group = groupBy(devices, 'locid');
        res.locationobj[locStart] = group;
      }
    }
  }
  return res;

  async function getDevicesByOneFilter(oneFilter) {
    return plugin.get('devices', oneFilter, { alerts: !!plugin.params.ae, dbsave: !!plugin.params.hda });
  }
}
