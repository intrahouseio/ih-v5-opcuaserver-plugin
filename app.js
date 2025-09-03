const util = require('util');
const fs = require("fs").promises;
const path = require("path");
const { OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
  DataValue,
  VariableHistorian,
  WellKnownRoles,
  makePermissionFlag,
  allPermissions,
  makeRoles,
  OPCUACertificateManager,
  MessageSecurityMode,
  SecurityPolicy
} = require('node-opcua');

module.exports = async function (plugin) {
  const params = plugin.params;
  let startTime = Date.now();
  const locations = await plugin.places.get();
  const placesObj = {};

  if (plugin.params.use_password && !plugin.params.password) {
    plugin.params.password = plugin.getPassword(plugin.params, 'password');
  }
  if (plugin.params.use_password_user && !plugin.params.password_user) {
    plugin.params.password_user = plugin.getPassword(plugin.params, 'password_user');
  }

  locations.forEach(item => {
    placesObj[item.id] = item.title;
  });

  let extraChannels = await plugin.extra.get();
  let filter = await filterExtraChannels(extraChannels);


  
  const userManager = {
    getUserRoles(userName) {
      //plugin.log("userName " + userName);
      if (params.use_password == 1) {
        if (userName == params.userName) return makeRoles('SecurityAdmin')
      }
      if (params.use_password_user == 1) {
        if (userName == params.userName_user) return makeRoles('AuthenticatedUser')
      }
      if (params.use_cert == 1) {
        if (userName == params.cert_clientName) return makeRoles('SecurityAdmin')
      }
      return makeRoles('');
    },
    isValidUser(userName, password) {
      if (params.use_password == 1) {
        if (userName === params.userName && password === params.password) {
          return true;
        }
      }
      if (params.use_password_user == 1) {
        if (userName === params.userName_user && password === params.password_user) {
          return true;
        }
      }
      return false;
    }

  };

  const rolePermissions = [
    {
      roleId: WellKnownRoles.Anonymous,
      permissions: allPermissions,
    },
    {
      roleId: WellKnownRoles.AuthenticatedUser,
      permissions: makePermissionFlag("Browse | Read | ReadHistory | ReceiveEvents")
    },
    {
      roleId: WellKnownRoles.ConfigureAdmin,
      permissions: makePermissionFlag("Browse | ReadRolePermissions | Read | ReadHistory | ReceiveEvents | Write")
    },
    {
      roleId: WellKnownRoles.SecurityAdmin,
      permissions: allPermissions
    },
  ]

  const serverPKIDir = path.join(__dirname, "pki");

  // Проверка и создание директории PKI
  if (!await fs.access(serverPKIDir).catch(() => false)) {
    await fs.mkdir(serverPKIDir, { recursive: true });
  }

  const serverCM = new OPCUACertificateManager({
    name: "ServerCertificateManager",
    rootFolder: serverPKIDir,
    automaticallyAcceptUnknownCertificate: params.trust_cert == 1 ? true : false // Для продакшена установить false
  });
  await serverCM.initialize();
  
  const server = new OPCUAServer({
    allowAnonymous: params.use_password == 1 || params.use_password_user == 1 ? 0 : 1,
    userManager: params.use_password == 1 || params.use_password_user == 1 || params.use_cert == 1 ? userManager : {},
    port: parseInt(params.port) || 4334, // the port of the listening socket of the server
    resourcePath: params.sourcepath || '/UA/IntraServer', // this path will be added to the endpoint resource name
    securityPolicies: [SecurityPolicy.None, SecurityPolicy.Basic256Sha256],
    securityModes: [MessageSecurityMode.None, MessageSecurityMode.Sign, MessageSecurityMode.SignAndEncrypt],
    serverCertificateManager: serverCM,
    buildInfo: {
      productName: 'IntraServer',
      buildNumber: '5.0.0',
      buildDate: new Date(2023, 6, 29)
    }
  });
  await server.initialize();

  server.start(() => {
    plugin.log('Server is now listening ... ', 1);
    plugin.log('port ' + server.endpoints[0].port, 1);
    const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
    plugin.log(' the primary server endpoint url is ' + endpointUrl, 1);
  });

   // Обработчики событий
    server.on("createSession", (session) => {
        plugin.log("🆕 Создана сессия:"+ session.sessionName || "unnamed",2);
    });

    server.on("session_activated", (session) => {
        const token = session.userIdentityToken;
        let user = "anonymous";
        if (token?.userName) user = token.userName;
        if (token?.certificateData) user = "certificate user";
        plugin.log("✅ Активирована сессия для пользователя:"+ user,2);
    });

    server.on("session_closed", (session, reason) => {
        plugin.log("🔚 Закрыта сессия:", reason);
    });

    server.on("session_authentication_failed", (session, reason) => {
        plugin.error("❌ Ошибка аутентификации:"+ reason.message || reason,2);
    });




  class myHistorian extends VariableHistorian {
    extractDataValues(historyReadRawModifiedDetails, maxNumberToExtract, isReversed, reverseDataValue, callback) {
      this.getData(this.node, historyReadRawModifiedDetails, (data) => {
        callback(null, data)
      })
    }
    async getData(node, histDetails, cb) {
      const dn_prop = node.nodeId.value.split("|")[1]
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
        dataValues.push(dataValue)
      })
      cb(dataValues);
    }
  }

  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();
  const objectsFolder = addressSpace.rootFolder.objects;

  const devicesNode = namespace.addFolder(objectsFolder, { browseName: 'Devices', nodeId: 's=Devices' });
  const locationNode = namespace.addFolder(objectsFolder, { browseName: 'Location', nodeId: 's=Location' });
  const alarmsEvents = namespace.addFolder(objectsFolder, { browseName: 'Alarms&Events', nodeId: 's=Alarms&Events', });
  const tagNode = namespace.addFolder(objectsFolder, { browseName: 'Tag', nodeId: 's=Tag' });
  // declare a new objects

  await subExtraChannels(filter);
  addOpcTag(filter.tagobj);
  addOpcLocation(filter.locationobj);
  addOpcDevices(filter.devicesobj);
  // plugin.log("filter " + util.inspect(filter, null, 4))

  function addOpcLocation(locationobj) {
    if (locationobj == undefined) return;

    for (const prop in locationobj) {
      const firstNode = namespace.addFolder(locationNode, {
        browseName: getPlaceName(prop),
        nodeId: 's=' + getNodeIdName(prop)
      });
      filter.folders[prop] = firstNode;
      let maxDepth = 1;
      const locationArr = Object.keys(locationobj[prop]).sort();
      locationArr.forEach(locid => {
        const depth = getDepth(locid);
        locationobj[prop][locid].depth = depth;
        locationobj[prop][locid].name = getPlaceName(locid)
        if (depth == 0) {
          locationobj[prop][locid].node = firstNode;
          if (locationobj[prop][locid].ref) addOpcObjects(locationobj[prop][locid].ref, firstNode, getNodeIdName(locid));
        } else if (depth > 1) {
          if (depth > maxDepth) maxDepth = depth;
          insertSkippedParent(prop, locid, depth);
        }
      });
      for (let i = 1; i <= maxDepth; i++) {
        Object.keys(locationobj[prop]).forEach(locid => {
          if (locationobj[prop][locid].depth == i) {
            let parentNode = i > 1 ? locationobj[prop][getParentLocation(locid)].node : firstNode;
            const curNode = namespace.addFolder(parentNode, {
              browseName: getPlaceName(locid),
              nodeId: 's=' + getNodeIdName(locid)
            });
            filter.folders[locid] = curNode;
            // в элемент locationobj добавить ссылку на добавленный folder: { ref: [ ], depth: 1, node:<curNode>  }, Нужно будет на следующем уровне depth
            locationobj[prop][locid].node = curNode;
            if (locationobj[prop][locid].ref) addOpcObjects(locationobj[prop][locid].ref, curNode, getNodeIdName(locid));
          }
        });

      }
    }

    // Если есть пропущенные уровни - добавить папки без устройств 'dg003/dg030':{depth:2}
    function insertSkippedParent(prop, locid, depth) {
      let xloc = locid;
      while (depth > 1) {
        const parentLocation = getParentLocation(xloc);
        depth = getDepth(parentLocation);
        if (!locationobj[prop][parentLocation]) locationobj[prop][parentLocation] = { depth };
        xloc = parentLocation;
      }
    }
  }

  function getPlaceName(locid) {
    const id = getLastPlace(locid);
    return id && placesObj[id] ? placesObj[id] : locid;
  }

  function getNodeIdName(locid) {
    let strLocation = '';
    locid.split('/').forEach(item => {
      strLocation += placesObj[item] + "(" + item + ")/";
    })
    return strLocation.slice(0, -1);
  }

  function addOpcDevices(devicesobj) {
    if (devicesobj.Devices != undefined) {
      addOpcObjects(devicesobj.Devices, devicesNode, 'Devices');
    }
  }

  function addOpcTag(tagobj) {
    if (tagobj) {
      for (const prop in tagobj) {
        const curNode = namespace.addFolder(tagNode, {
          browseName: prop,
          nodeId: 's=' + prop
        });
        filter.folders[prop] = curNode;
        addOpcObjects(tagobj[prop], curNode, prop);
      }
    }
  }


  function addOpcObjects(arr, node, nodeName) {
    let deviceAlarm = {};
    let curTime = Date.now();
    let varcnt = params.ae ? 99 : 999
    let l = 0;
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
      filter.devices[item._id] = device;
      if (l == varcnt) {
        plugin.log(`Time elapsed: added ${i} ${Date.now() - curTime} ms`, 1);
        curTime = Date.now();
        l = 0;
      } else {
        l++;
      }
      //Добавление аларма у устройства
      if (params.ae && Object.keys(item.alerts).length !== 0) {
        if (!filter.alarmsEvents[item._id]) {
          deviceAlarm = namespace.addObject({
            organizedBy: alarmsEvents,
            nodeId: 's=Alarms&Events' + '|' + item.dn,
            browseName: item.dn,
            displayName: item.name + ' (' + item.dn + ')',
            eventNotifier: 1,
            notifierOf: alarmsEvents,
          });
          filter.alarmsEvents[item._id] = deviceAlarm;
          filter.alarmsEvents[item._id].ref = new Set();
        }
        if (!filter.alarmsEvents[item._id].cnt) filter.alarmsEvents[item._id].cnt = 0
        filter.alarmsEvents[item._id].cnt++;
        //Условие заканчивается здесь
      }

      for (const property in item.props) {
        if (
          item.props[property].op == 'calc' ||
          item.props[property].op == 'par' ||
          item.props[property].op == 'rw' ||
          item.props[property].op == 'r' ||
          item.props[property].op == 'evnt'
        ) {
          let dataType = {};
          if (item.props[property].vtype == 'N') {
            dataType.s = 'Double';
            dataType.obj = DataType.Double;
          }
          if (item.props[property].vtype == 'S') {
            dataType.s = 'String';
            dataType.obj = DataType.String;
          }
          if (item.props[property].vtype == 'B') {
            dataType.s = 'Boolean';
            dataType.obj = DataType.Boolean;
          }

          const variable = namespace.addVariable({
            componentOf: device,
            eventSourceOf: device,
            nodeId: 's=' + nodeName + '|' + item.dn + '.' + property,
            browseName: property + ' (' + item.dn + ') ',
            dataType: dataType.s,
            description: item.props[property].name,
            minimumSamplingInterval: 1000,
            rolePermissions,
            value: {
              timestamped_get: function () {
                let dataValue = new DataValue({
                  value: new Variant({
                    dataType: dataType.obj,
                    value:
                      dataType.s == 'Boolean'
                        ? filter.devices[item._id + '.' + property].value == 1
                        : filter.devices[item._id + '.' + property].value
                  }),
                  statusCode: filter.devices[item._id + '.' + property].chstatus,
                  sourceTimestamp: filter.devices[item._id + '.' + property].ts,
                  sourcePicoseconds: 0,
                  serverTimestamp: filter.devices[item._id + '.' + property].ts,
                  serverPicoseconds: 0
                });
                return dataValue;
              },

              set: variant => {
                plugin.log('variant set ' + util.inspect(variant, null, 4))
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

          //Добавление истории в устройство
          if (params.hda && item.dbsave.includes(property)) {
            const myhist = new myHistorian(variable, {
              maxOnlineValues: 1000
            });
            addressSpace.installHistoricalDataNode(variable, { historian: myhist });
          }

          ////Добавление аларма для свойства устройства
          if (params.ae && item.alerts[property] != undefined) {
            if (!filter.alarmsEvents[item._id].ref.has(item._id + "." + property)) {
              filter.alarmsEvents[item._id].ref.add(item._id + "." + property);
              if (variable.dataType.value == 1) {
                const discreteAlarm = addressSpace.findEventType("DiscreteAlarmType");
                const alarm = namespace.instantiateDiscreteAlarm(discreteAlarm, {
                  organizedBy: deviceAlarm,
                  //componentOf: deviceAlarm,
                  conditionSource: variable,
                  conditionOf: deviceAlarm,
                  browseName: property + ' (' + item.dn + ')' + ' alarm',
                  inputNode: variable,   // the variable that will be monitored for change
                  optionals: [
                    "ConfirmedState", "Confirm" // confirm state and confirm Method
                  ]
                });
                variable.on("value_changed", function (newDataValue, oldDataValue) {
                  if (newDataValue.value.value == true) alarm.raiseNewCondition({ message: "Alarm" });
                  if (newDataValue.value.value == false) alarm.raiseNewCondition({ message: "Normal" });
                });
              }

              if (variable.dataType.value == 11) {
                const limitAlarm = addressSpace.findEventType("NonExclusiveLimitAlarmType");
                namespace.instantiateNonExclusiveLimitAlarm(limitAlarm, {
                  browseName: property + ' (' + item.dn + ')' + ' alarm',
                  //conditionName: property + ' (' + item.dn + ')' + ' alarm',
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
      }
      //});
    }
  }

  function subExtraChannels(filter) {
    return new Promise((resolve, reject) => {
      plugin.onSub('devices', filter, data => {
        //plugin.log('data' + util.inspect(data), 2);
        data.forEach(item => {
          const didProp = item.did + '.' + item.prop;
          if (filter.devices[didProp] != undefined) {
            if (item.value == undefined) {
              if (filter.devices[didProp].vtype == 'S') {
                filter.devices[didProp].value = String(filter.devices[didProp].value);
              } else {
                filter.devices[didProp].value = Number(filter.devices[didProp].value);
              }
            } else {
              if (filter.devices[didProp].vtype == 'S') {
                filter.devices[didProp].value = String(item.value);
              } else {
                filter.devices[didProp].value = Number(item.value);
              }
            }

            if (item.chstatus > 0) {
              filter.devices[didProp].chstatus = StatusCodes.BadWaitingForInitialData
            } else {
              filter.devices[didProp].chstatus = StatusCodes.Good
            }
            if (item.ts) {
              filter.devices[didProp].ts = item.ts;
            } else {
              filter.devices[didProp].ts = Date.now();
            }
          }
        });
        resolve();
      });
    })

  }

  plugin.onChange('extra', async recs => {
    plugin.log('onChange addExtra ' + util.inspect(recs), 2);
    let curfilter = {
      did_prop: [],
      devices: {},
      locationobj: {},
      tagobj: {},
      devicesobj: {}
    };
    for (let index = 0; index < recs.length; index++) {
      //Добавление расширений
      if (recs[index].op == 'add') {
        if (recs[index].filter == 'location') {
          await addLocation(recs[index].locationStr);
        }
        if (recs[index].filter == 'device') {
          const did = recs[index].did;
          //const devices = await plugin.devices.get({ did: [did] });
          const devices = await plugin.get('devices', { did: [did] }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          curfilter.devicesobj.Devices = devices;
          filter.devicesobj.Devices = devices;
          devices.forEach(item => {
            for (const property in item.props) {
              curfilter.did_prop.push(item._id + '.' + property);
              filter.did_prop.push(item._id + '.' + property);
              curfilter.devices[item._id + '.' + property] = item.props[property];
              filter.devices[item._id + '.' + property] = item.props[property];
            }
          });
          await subExtraChannels(curfilter);
          addOpcDevices(curfilter.devicesobj);
        }
        if (recs[index].filter == 'tag') {
          const tag = recs[index].tagStr;
          //const devices = await plugin.devices.get({ tag });
          const devices = await plugin.get('devices', { tag }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          curfilter.tagobj[tag] = [];
          filter.tagobj[tag] = [];
          filter.tagobj[tag].push(...devices);
          curfilter.tagobj[tag].push(...devices);
          devices.forEach(item => {
            for (const property in item.props) {
              curfilter.did_prop.push(item._id + '.' + property);
              filter.did_prop.push(item._id + '.' + property);
              curfilter.devices[item._id + '.' + property] = item.props[property];
              filter.devices[item._id + '.' + property] = item.props[property];
            }
          });
          await subExtraChannels(curfilter);
          addOpcTag(curfilter.tagobj);
        }

      }
      //Удаление расширений
      if (recs[index].op == 'delete') {
        if (recs[index].filter == 'location') {
          deleteLocation(recs[index].locationStr);
          //const devices = await plugin.devices.get({ location: recs[index].locationStr });
          const devices = await plugin.get('devices', { location: recs[index].locationStr }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          devices.forEach(item => {
            deleteAlarmsEvents(item._id)
          })
        }
        if (recs[index].filter == 'device') {
          deleteAlarmsEvents(recs[index].did);
          if (filter.devices[recs[index].did]) namespace.deleteNode(filter.devices[recs[index].did]);
          //delete filter.devices[recs[index].did];
        }
        if (recs[index].filter == 'tag') {
          const tag = recs[index].tagStr;
          if (filter.folders[tag]) namespace.deleteNode(filter.folders[tag]);
          //const devices = await plugin.devices.get({ tag });
          const devices = await plugin.get('devices', { tag }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          devices.forEach(item => {
            deleteAlarmsEvents(item._id);
          })
        }
      }
      //Обновление расширений
      if (recs[index].op == 'update') {
        if (recs[index].filter == 'location') {
          deleteLocation(recs[index].locationStr);
          //const devices = await plugin.devices.get({ location: recs[index].locationStr });
          const devices = await plugin.get('devices', { location: recs[index].locationStr }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          devices.forEach(item => {
            deleteAlarmsEvents(item._id)
          })
          await addLocation(recs[index].$set.locationStr);
        }

        if (recs[index].filter == 'device') {
          deleteAlarmsEvents(recs[index].did);
          if (filter.devices[recs[index].did] != undefined) namespace.deleteNode(filter.devices[recs[index].did]);
          // const devices = await plugin.devices.get({ did: [recs[index].$set.did] });
          const devices = await plugin.get('devices', { did: [recs[index].$set.did] }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          curfilter.devicesobj.Devices = devices;
          filter.devicesobj.Devices = devices;
          devices.forEach(item => {
            for (const property in item.props) {
              curfilter.did_prop.push(item._id + '.' + property);
              filter.did_prop.push(item._id + '.' + property);
              curfilter.devices[item._id + '.' + property] = item.props[property];
              filter.devices[item._id + '.' + property] = item.props[property];
            }
          });
          await subExtraChannels(curfilter);
          addOpcDevices(curfilter.devicesobj);
        }
        if (recs[index].filter == 'tag') {
          let tag = recs[index].tagStr;
          if (filter.folders[tag]) namespace.deleteNode(filter.folders[tag]);
          //const devicesdel = await plugin.devices.get({ tag });
          const devicesdel = await plugin.get('devices', { tag }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          devicesdel.forEach(item => {
            deleteAlarmsEvents(item._id);
          })
          tag = recs[index].$set.tagStr;
          //const devices = await plugin.devices.get({ tag });
          const devices = await plugin.get('devices', { tag }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          curfilter.tagobj[tag] = [];
          filter.tagobj[tag] = [];
          filter.tagobj[tag].push(...devices);
          curfilter.tagobj[tag].push(...devices);
          devices.forEach(item => {
            for (const property in item.props) {
              curfilter.did_prop.push(item._id + '.' + property);
              filter.did_prop.push(item._id + '.' + property);
              curfilter.devices[item._id + '.' + property] = item.props[property];
              filter.devices[item._id + '.' + property] = item.props[property];
            }
          });
          await subExtraChannels(curfilter);
          addOpcTag(curfilter.tagobj);
        }
      }
    }

    async function addLocation(locationStr) {
      //const devices = await plugin.devices.get({ location: locationStr });
      const devices = await plugin.get('devices', { location: locationStr }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
      const locStart = getLastPlace(locationStr);
      devices.forEach(item => {
        item.locid = locStart == item.parent ? item.parent : getTailLocation(item.location, locStart);
      });

      // const group = groupBy(devices, 'location');
      const group = groupBy(devices, 'locid');
      curfilter.locationobj[locStart] = group;
      devices.forEach(item => {
        for (const property in item.props) {
          curfilter.did_prop.push(item._id + '.' + property);
          filter.did_prop.push(item._id + '.' + property);
          curfilter.devices[item._id + '.' + property] = item.props[property];
          filter.devices[item._id + '.' + property] = item.props[property];
        }
      });
      await subExtraChannels(curfilter);
      addOpcLocation(curfilter.locationobj);
    }

    function deleteLocation(locationStr) {
      const locid = getLastPlace(locationStr);
      if (filter.folders[locid]) {
        namespace.deleteNode(filter.folders[locid]);
      }
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
  });

  


  process.on('exit', terminate);
  process.on('SIGTERM', () => {
    terminate();
    process.exit(0);
  });

  function terminate() {
    // console.log('TERMINATE PLUGIN');
    // Здесь закрыть все что нужно
  }

  async function filterExtraChannels(channels) {
    let res = {
      did_prop: [],
      devices: {},
      folders: {},
      devicesobj: {},
      locationobj: {},
      tagobj: {},
      alarmsEvents: {}
    };

    const groupchannels = groupBy(channels, 'filter');
    for (const element in groupchannels) {
      let curdevices = [];
      if (element == 'device') {
        //const devices = await plugin.devices.get({ did: groupchannels[element].didarr });
        const devices = await plugin.get('devices', { did: groupchannels[element].didarr }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
        res.devicesobj.Devices = devices;
        curdevices.push(...devices);
      }

      if (element == 'location') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const location = groupchannels[element].ref[i].locationStr;
          //const devices = await plugin.devices.get({ location });
          const devices = await plugin.get('devices', { location }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          const locStart = getLastPlace(location);
          devices.forEach(item => {
            item.locid = locStart == item.parent ? item.parent : getTailLocation(item.location, locStart);
          });

          // const group = groupBy(devices, 'location');
          const group = groupBy(devices, 'locid');
          res.locationobj[locStart] = group;
          curdevices.push(...devices);
        }
      }
      if (element == 'tag') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const tag = groupchannels[element].ref[i].tagStr;
          //const devices = await plugin.devices.get({ tag });
          const devices = await plugin.get('devices', { tag }, { alerts: params.ae ? true : false, dbsave: params.hda ? true : false });
          res.tagobj[tag] = [];
          res.tagobj[tag].push(...devices);
          curdevices.push(...devices);
        }
      }
      curdevices.forEach(item => {
        for (const property in item.props) {
          res.did_prop.push(item._id + '.' + property);
          res.devices[item._id + '.' + property] = item.props[property];
        }
      });
    }
    return res;
  }

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

  function getDepth(loc) {
    // dg002 => 0
    // dg002/dg022/dg222 => 2
    const arr = loc.split('/').filter(el => el);
    return arr.length - 1;
  }

  function getParentLocation(loc) {
    // Вернуть без последнего элемента dg002/dg022/dg222 => dg002/dg022
    return loc
      .split('/')
      .filter(el => el)
      .slice(0, -1)
      .join('/');
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
};
