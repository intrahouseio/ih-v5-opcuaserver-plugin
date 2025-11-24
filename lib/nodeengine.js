/**
 * nodeengine.js
 *
 */

const util = require('util');
const { Variant, StatusCodes, DataValue, VariableHistorian } = require('node-opcua');

const rolepermissions = require('./rolepermissions');
const locationformer = require('./locationformer');
const utils = require('./utils');

module.exports = async function (plugin, addressSpace) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };

  class myHistorian extends VariableHistorian {
    extractDataValues(historyReadRawModifiedDetails, maxNumberToExtract, isReversed, reverseDataValue, callback) {
      this.getData(this.node, historyReadRawModifiedDetails, data => {
        callback(null, data);
      });
    }

    async getData(node, histDetails, cb) {
      const dn_prop = node.nodeId.value.split('|')[1];
      let dataValues = [];
      const start = new Date(histDetails.startTime);
      const end = new Date(histDetails.endTime);
      const result = await plugin.get('hist', { dn_prop, start: start.getTime(), end: end.getTime() });
      result.forEach(item => {
        const dataValue = new DataValue({
          value: new Variant({
            dataType: node.dataType.value,
            value: item.val
          }),
          sourceTimestamp: item.ts,
          sourcePicoseconds: 0,
          serverTimestamp: item.ts,
          serverPicoseconds: 0
        });
        dataValues.push(dataValue);
      });
      cb(dataValues);
    }
  }

  const params = plugin.params;
  const rolePermissions = rolepermissions();

  const filter = {
    devices: {}, // текущие значения для свойств устройств
    folders: { Devices: { devNodes: {} } }, // хранятся ссылки на сгенерированные узлы для всех фильтров
    alarmsEvents: {}
  };

  const namespace = addressSpace.getOwnNamespace();
  const objectsFolder = addressSpace.rootFolder.objects;

  const devicesNode = namespace.addFolder(objectsFolder, { browseName: 'Devices', nodeId: 's=Devices' });
  const locationNode = namespace.addFolder(objectsFolder, { browseName: 'Location', nodeId: 's=Location' });
  const alarmsEvents = namespace.addFolder(objectsFolder, { browseName: 'Alarms&Events', nodeId: 's=Alarms&Events' });
  const tagNode = namespace.addFolder(objectsFolder, { browseName: 'Tag', nodeId: 's=Tag' });

  plugin.onSub('devices', { extra: 1 }, data => {
    //plugin.log('data onSub ' + util.inspect(data), 2);
    data.forEach(item => {
      updateDeviceValue(item);
    });
  });

  try {
    locationformer.start(plugin, params);
    const extraChannels = await plugin.extra.get();
    await addOpcNodes(extraChannels);
  } catch (e) {
    plugin.log('ERROR: Try start: ' + util.inspect(e));
  }

  plugin.onChange('extra', async recs => {
    plugin.log('onChange extra ' + util.inspect(recs), 2);
    try {
      const groupByOp = utils.groupBy(recs, 'op');
      for (const op in groupByOp) {
        if (op == 'delete') {
          deleteOpcNodesForFilters(groupByOp[op].ref);
        } else if (op == 'update') {
          deleteOpcNodesForFilters(groupByOp[op].ref);
          await addOpcNodes(groupByOp[op].ref);
        } else if (op == 'add') {
          await addOpcNodes(groupByOp[op].ref);
        }
      }
    } catch (e) {
      plugin.log('ERROR: onChange extra ' + util.inspect(e));
    }
  });

  plugin.onExtraMatch('devices', async arr => {
    plugin.log('onExtraMatch ' + util.inspect(arr), 2);

    for (const item of arr) {
      const { include, exclude, ...dev } = item;
      excludeDevNodes(exclude, dev);
      await includeDevNodes(include, dev);
    }
  });



  function excludeDevNodes(exclude, dev) {
    if (!exclude || !exclude.length) return;
    exclude.forEach(fobj => {
      try {
        const keyInFolder = utils.getFolderForFilter(fobj);
        if (!filter.folders[keyInFolder]) throw 'No folder in filter.folders!';

        deleteDeviceNode(keyInFolder, dev._id);
      } catch (e) {
        plugin.log('ERROR: onExtraMatch exclude: filter ' + util.inspect(fobj) + ', did=' + dev._id + ': ' + util.inspect(e));
      }
    });
  }

  function deleteDeviceNode(key, did) {
    const devNode = filter.folders[key].devNodes[did];
    // удалить ссылку в devNodes
    delete filter.folders[key].devNodes[did];
    // удалить узел устройства
    if (devNode) namespace.deleteNode(devNode);
    // ToDo - Проверить, если больше нет вхождений - удалить из filter.devices
  }

  async function includeDevNodes(include, dev) {
    if (!include || !include.length) return;

    for (const fobj of include) {
      try {
        const keyInFolder = utils.getFolderForFilter(fobj);
        let curNode = filter.folders[keyInFolder].folderNode;

        if (fobj.filter == 'location') {
          curNode = await getFolderNodeForDeviceInLocation(keyInFolder, dev);
        }
        if (!curNode) throw 'No folder in filter.folders!';

        addOpcObjects([dev], curNode, keyInFolder, filter.folders[keyInFolder].devNodes);
      } catch (e) {
        plugin.log('ERROR: onExtraMatch include: filter ' + util.inspect(fobj) + ', did=' + dev._id + util.inspect(e));
      }
    }
  }

  async function getFolderNodeForDeviceInLocation(keyInFolder, dev) {
    if (keyInFolder == dev.parent) return filter.folders[keyInFolder].folderNode;

    const locid = utils.getTailLocation(dev.location, keyInFolder);
    if (filter.folders[keyInFolder].subfolderNodes[locid]) return filter.folders[keyInFolder].subfolderNodes[locid];

    // папки может и не быть - добавить новую папку(папки)
    if (!locationformer.existsPlace(dev.parent)) {
      await locationformer.loadPlaces();
    }
    return addSubfolders(keyInFolder, locid);
  }

  function addSubfolders(keyInFolder, locid) {
    const locationobj = { [keyInFolder]: { [locid]: locationformer.getLocationItem(locid) } };
    locationformer.insertSkippedParent(locationobj, keyInFolder, locid);

    const subfolderArr = Object.keys(locationobj[keyInFolder]).sort();

    let parentNode = filter.folders[keyInFolder].folderNode;
    subfolderArr.forEach(key => {
      const item = locationobj[keyInFolder][key];

      if (filter.folders[keyInFolder].subfolderNodes[key]) {
        parentNode = filter.folders[keyInFolder].subfolderNodes[key];
      } else {
        // Добавить
        const curNode = namespace.addFolder(parentNode, {
          browseName: item.name,
          nodeId: 's=' + item.nodeId
        });
        filter.folders[keyInFolder].subfolderNodes[key] = curNode;
        parentNode = curNode;
      }
    });
    return parentNode;
  }

  function updateDeviceValue(item) {
    const didProp = item.did + '.' + item.prop;
    if (filter.devices[didProp] != undefined) {
      if (item.value == undefined) {
        if (filter.devices[didProp].vtype == 'S' || filter.devices[didProp].vtype == 'I') {
          // I - BigInt
          filter.devices[didProp].value = String(filter.devices[didProp].value);
        } else {
          filter.devices[didProp].value = Number(filter.devices[didProp].value);
        }
      } else if (filter.devices[didProp].vtype == 'S' || filter.devices[didProp].vtype == 'I') {
        filter.devices[didProp].value = String(item.value);
      } else {
        filter.devices[didProp].value = Number(item.value);
      }

      if (item.chstatus > 0) {
        filter.devices[didProp].chstatus = StatusCodes.BadWaitingForInitialData;
      } else {
        filter.devices[didProp].chstatus = StatusCodes.Good;
      }
      if (item.ts > 0) {
        filter.devices[didProp].ts = item.ts;
      } else {
        filter.devices[didProp].ts = Date.now();
      }
    }
  }

  async function addOpcNodes(extraChannels) {
    const { tagobj, devicesobj, locationobj } = await utils.getDevicesForExtra(extraChannels, plugin);
    addOpcTag(tagobj);
    addOpcDevices(devicesobj);
    await addOpcLocation(locationobj);
  }

  function addOpcDevices(devicesobj) {
    if (!devicesobj.Devices) return;
    addOpcObjects(devicesobj.Devices, devicesNode, 'Devices', filter.folders.Devices.devNodes);
  }

  function addOpcTag(tagobj) {
    if (!tagobj) return;
    for (const prop in tagobj) {
      const curNode = namespace.addFolder(tagNode, {
        browseName: prop,
        nodeId: 's=' + prop
      });
      filter.folders[prop] = { folderNode: curNode, devNodes: {} };
      addOpcObjects(tagobj[prop], curNode, prop, filter.folders[prop].devNodes);
    }
  }

  async function addOpcLocation(locationobj) {
    if (!locationobj) return;

    try {
      await locationformer.loadPlaces();
      locationformer.prepare(locationobj);

      let firstNode;
      for (const prop in locationobj) {
        let maxDepth = 1;

        for (const locid in locationobj[prop]) {
          let item;
          try {
            item = locationobj[prop][locid];
            const depth = item.depth;
            if (depth > maxDepth) maxDepth = depth;
            if (depth == 0) {
              firstNode = namespace.addFolder(locationNode, {
                browseName: item.name,
                nodeId: 's=' + item.nodeId
              });
              filter.folders[prop] = { folderNode: firstNode, devNodes: {}, subfolderNodes: {} };
              locationobj[prop][locid].node = firstNode;
              if (locationobj[prop][locid].ref) {
                addOpcObjects(locationobj[prop][locid].ref, firstNode, item.nodeId, filter.folders[prop].devNodes);
              }
            }
          } catch (e) {
            plugin.log('ERROR: 1 addOpcLocation prop=' + prop + ' locid=' + locid + util.inspect(e));
          }
        }

        for (let i = 1; i <= maxDepth; i++) {
          Object.keys(locationobj[prop]).forEach(locid => {
            let item;
            try {
              item = locationobj[prop][locid];
              if (item.depth == i) {
                const parentNode = i > 1 ? locationobj[prop][item.parentLocation].node : firstNode;

                const curNode = namespace.addFolder(parentNode, {
                  browseName: item.name,
                  nodeId: 's=' + item.nodeId
                });
                filter.folders[prop].subfolderNodes[locid] = curNode;
                // в элемент locationobj добавить ссылку на добавленный folder: { ref: [ ], depth: 1, node:<curNode>  }, Нужно будет на следующем уровне depth
                locationobj[prop][locid].node = curNode;
                if (locationobj[prop][locid].ref) {
                  addOpcObjects(locationobj[prop][locid].ref, curNode, item.nodeId, filter.folders[prop].devNodes);
                }
              }
            } catch (e) {
              plugin.log('ERROR: 2 addOpcLocation prop=' + prop + ' locid=' + locid + util.inspect(e));
            }
          });
        }
      }
    } catch (e) {
      plugin.log('ERROR: addOpcLocation ' + util.inspect(e));
    }
  }

  function addOpcObjects(arr, node, nodeName, devNodesInFolders) {
    let deviceAlarm = {};

    for (let i = 0; i < arr.length; i++) {
      let item = arr[i];
      if (item.alerts == undefined) item.alerts = {};
      if (item.dbsave == undefined) item.dbsave = [];
      const device = namespace.addObject({
        organizedBy: node,
        nodeId: 's=' + nodeName + '|' + item.dn,
        browseName: item.dn,
        displayName: item.name + ' (' + item.dn + ') '
      });

      devNodesInFolders[item._id] = device;

      // Добавление аларма у устройства
      if (params.ae && Object.keys(item.alerts).length !== 0) {
        if (!filter.alarmsEvents[item._id]) {
          deviceAlarm = namespace.addObject({
            organizedBy: alarmsEvents,
            nodeId: 's=Alarms&Events' + '|' + item.dn,
            browseName: item.dn,
            displayName: item.name + ' (' + item.dn + ')',
            eventNotifier: 1,
            notifierOf: alarmsEvents
          });
          filter.alarmsEvents[item._id] = deviceAlarm;
          filter.alarmsEvents[item._id].ref = new Set();
        }
        if (!filter.alarmsEvents[item._id].cnt) filter.alarmsEvents[item._id].cnt = 0;
        filter.alarmsEvents[item._id].cnt++;
        // Условие заканчивается здесь
      }

      for (const property in item.props) {
        try {
          if (
            item.props[property].op == 'calc' ||
            item.props[property].op == 'par' ||
            item.props[property].op == 'rw' ||
            item.props[property].op == 'r' ||
            item.props[property].op == 'evnt'
          ) {
            filter.devices[item._id + '.' + property] = item.props[property];
            let dataType = utils.getDataType(item.props[property].vtype);

            let variable;
            try {
              variable = namespace.addVariable({
                componentOf: device,
                eventSourceOf: device,
                nodeId: 's=' + nodeName + '|' + item.dn + '.' + property,
                browseName: property + ' (' + item.dn + ') ',
                dataType: dataType.s,
                description: item.props[property].name,
                minimumSamplingInterval: 100,
                rolePermissions,
                value: {
                  timestamped_get() {
                    let dataValue = new DataValue({
                      value: new Variant({
                        dataType: dataType.obj,
                        value:
                          dataType.s == 'Boolean'
                            ? filter.devices[item._id + '.' + property].value == 1
                            : filter.devices[item._id + '.' + property].value
                      }),
                      statusCode: filter.devices[item._id + '.' + property].chstatus,
                      sourceTimestamp: filter.devices[item._id + '.' + property].ts > 0 ? filter.devices[item._id + '.' + property].ts : Date.now(),
                      sourcePicoseconds: 0,
                      serverTimestamp: filter.devices[item._id + '.' + property].ts > 0 ? filter.devices[item._id + '.' + property].ts : Date.now(),
                      serverPicoseconds: 0
                    });
                    return dataValue;
                  },

                  set: variant => {
                    plugin.log('variant set ' + util.inspect(variant, null, 4));
                    let val;
                    if (variant.dataType == 1) {
                      val = variant.value == true ? 1 : 0;
                    }
                    if (variant.dataType == 11) {
                      val = parseFloat(variant.value);
                    }
                    if (variant.dataType == 12) {
                      val = String(variant.value);
                    }
                    plugin.send({
                      type: 'command',
                      command: 'setval',
                      did: item._id,
                      prop: property,
                      value: val
                    });
                    return StatusCodes.Good;
                  }
                }
              });
            } catch (e) {
              plugin.log('ERROR: addVariable ' + item._id + ' property=' + property);
            }

            // Добавление истории в устройство
            plugin.log("item.dbsave " + util.inspect(item.dbsave));
            if (params.hda && item.dbsave.includes(property)) {
              const myhist = new myHistorian(variable, {
                maxOnlineValues: 1000
              });
              addressSpace.installHistoricalDataNode(variable, { historian: myhist });
            }

            // //Добавление аларма для свойства устройства
            if (params.ae && item.alerts[property] != undefined) {
              if (!filter.alarmsEvents[item._id].ref.has(item._id + '.' + property)) {
                filter.alarmsEvents[item._id].ref.add(item._id + '.' + property);
                if (variable.dataType.value == 1) {
                  const discreteAlarm = addressSpace.findEventType('DiscreteAlarmType');
                  const alarm = namespace.instantiateDiscreteAlarm(discreteAlarm, {
                    organizedBy: deviceAlarm,
                    // componentOf: deviceAlarm,
                    conditionSource: variable,
                    conditionOf: deviceAlarm,
                    browseName: property + ' (' + item.dn + ')' + ' alarm',
                    inputNode: variable, // the variable that will be monitored for change
                    optionals: [
                      'ConfirmedState',
                      'Confirm' // confirm state and confirm Method
                    ]
                  });
                  variable.on('value_changed', (newDataValue, oldDataValue) => {
                    if (newDataValue.value.value == true) alarm.raiseNewCondition({ message: 'Alarm' });
                    if (newDataValue.value.value == false) alarm.raiseNewCondition({ message: 'Normal' });
                  });
                }

                if (variable.dataType.value == 11) {
                  const limitAlarm = addressSpace.findEventType('NonExclusiveLimitAlarmType');
                  namespace.instantiateNonExclusiveLimitAlarm(limitAlarm, {
                    browseName: property + ' (' + item.dn + ')' + ' alarm',
                    // conditionName: property + ' (' + item.dn + ')' + ' alarm',
                    componentOf: deviceAlarm,
                    conditionSource: variable,
                    conditionOf: deviceAlarm,
                    highHighLimit: item.alerts[property].HiHi,
                    highLimit: item.alerts[property].Hi,
                    inputNode: variable,
                    lowLimit: item.alerts[property].Lo,
                    lowLowLimit: item.alerts[property].LoLo
                  });
                }
              }
            }
          }

          if (item.props[property].op == 'cmd') {
            const method = namespace.addMethod(device, {
              componentOf: device,
              nodeId: 's=' + nodeName + '|' + item.dn + '.' + property,
              browseName: property + '()' + ' (' + item.dn + ')',
              description: item.props[property].name,
              rolePermissions
            });
            method.bindMethod((inputArguments, context, callback) => {
              plugin.send({ type: 'command', command: 'device', did: item._id, prop: property });
              const callMethodResult = {
                statusCode: StatusCodes.Good
              };
              callback(null, callMethodResult);
            });
          }
        } catch (e) {
          plugin.log('ERROR: addOpcObjects ' + item.dn + ' prop=' + property + " error " + e);
        }
      }
    }
  }

  function deleteOpcNodesForFilters(arr) {
    if (!arr || !arr.length) return;

    arr.forEach(fobj => {
      try {
        const key = utils.getFolderForFilter(fobj);
        if (!filter.folders[key]) throw 'No folder in filter.folders!';

        for (const did in filter.folders[key].devNodes) {
          deleteDeviceNode(did);
        }

        // Удалить узлы подпапок
        if (filter.folders[key].subfolderNodes) {
          for (const subid in filter.folders[key].subfolderNodes) {
            const subNode = filter.folders[key].subfolderNodes[subid];
            delete filter.folders[key].subfolderNodes[subid];
            if (subNode) namespace.deleteNode(subNode);
          }
        }

        // Удалить основную папку
        if (filter.folders[key].folderNode) namespace.deleteNode(filter.folders[key].folderNode);
        delete filter.folders[key].folderNode;
      } catch (e) {
        plugin.log('ERROR: deleteOpcNodesForFilters ' + util.inspect(fobj) + ': ' + util.inspect(e));
      }
    });
  }

  function deleteAlarmsEvents(id) {
    if (filter.alarmsEvents[id]) {
      if (filter.alarmsEvents[id].cnt > 1) {
        filter.alarmsEvents[id].cnt--;
      } else {
        namespace.deleteNode(filter.alarmsEvents[id]);
        delete filter.alarmsEvents[id];
      }
    }
  }


};
