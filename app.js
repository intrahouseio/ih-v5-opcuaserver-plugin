const util = require('util');
const tools = require('./tools');
const { OPCUAServer, Variant, DataType, StatusCodes, makeAccessLevelFlag } = require("node-opcua");

module.exports = async function (plugin) {
  const params = plugin.params;
  const locations = await plugin.places.get();
  const locationsObj = {}
  locations.forEach(item => {
    locationsObj[item.location] = item.title;
  })
  let extraChannels = await plugin.extra.get();
  let filter = await filterExtraChannels(extraChannels);
  
  plugin.log("locationsObj " + util.inspect(locationsObj, null, 4));
  const server = new OPCUAServer({
    port: parseInt(params.port) || 4334, // the port of the listening socket of the server
    resourcePath: params.sourcepath || "/UA/IntraServer", // this path will be added to the endpoint resource name
    buildInfo: {
      productName: "IntraServer",
      buildNumber: "5.0.0",
      buildDate: new Date(2023, 6, 29)
    }
  });
  await server.initialize();
  plugin.log("initialized");
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();
  const objectsFolder = addressSpace.rootFolder.objects;

  const devicesNode = namespace.addFolder(objectsFolder, { browseName: "Devices", nodeId: "s=Devices" });
  const locationNode = namespace.addFolder(objectsFolder, { browseName: "Location", nodeId: "s=Location" });
  const tagNode = namespace.addFolder(objectsFolder, { browseName: "Tag", nodeId: "s=Tag" });
  // declare a new objects

  addOpcTag(filter.tagobj);
  addOpcLocation(filter.locationobj);
  addOpcDevices(filter.devicesobj);
  subExtraChannels(filter);

  function addOpcLocation(locationobj) {
    plugin.log('locationobj = ' + util.inspect(locationobj, null, 4));
    if (locationobj != undefined) {
      for (const prop in locationobj) {
        let maxDepth = 1;
        const locationArr = Object.keys(locationobj[prop]).sort();
        
        locationArr.forEach(location => {
          let depth = getDepth(location);
          locationobj[prop][location].depth = depth;
          if (depth > maxDepth) maxDepth = depth;
          let xloc = location;
          while (depth > 1) {
            const parentLocation = getParentLocation(xloc);
            depth = getDepth(parentLocation);
            // Если есть пропущенные уровни - добавить как элементы без устройств '/place/dg003/dg010':{depth:2}
            if (!locationobj[prop][parentLocation]) locationobj[prop][parentLocation] = { depth };
            xloc = parentLocation;
          }
        });
        plugin.log('1 locationobj[prop] = ' + util.inspect(locationobj[prop], null, 4));

        for (let i = 1; i <= maxDepth; i++) {
          Object.keys(locationobj[prop]).forEach(location => {
            if (locationobj[prop][location].depth == i) {
              let parentNode;
              if (i == 1) {
                parentNode = locationNode;
              } else {
                const parentLocation = getParentLocation(location);
                parentNode = locationobj[prop][parentLocation].node;
              }
              const curNode = namespace.addFolder(parentNode, {
                browseName: locationsObj[location],
                nodeId: "s=" + location
              });

              // в элемент locationobj добавить ссылку на добавленный folder: { ref: [ ], depth: 1, node:<curNode>  },
              // Нужно будет на следующем уровне
              locationobj[prop][location].node = curNode;
              plugin.log('Before add opObjects = ' + util.inspect(location, null, 4));
              plugin.log('Before add opObjects ref = ' + util.inspect(locationobj[prop][location].ref, null, 4));
              plugin.log('Before add opObjects node = ' + util.inspect(curNode, null, 4));
              // Если есть устройства - их добавить
              if (locationobj[prop][location].ref) addOpcObjects(locationobj[prop][location].ref, curNode, location);

              plugin.log("After add opObjects "  + location)
            }
          });
        }
      }
    }
  }

  function addOpcDevices(devicesobj) {
    if (devicesobj != undefined) {
      addOpcObjects(devicesobj.Devices, devicesNode, "Devices");
    }
  }

  function addOpcTag(tagobj) {
    if (tagobj != undefined) {
      for (const prop in tagobj) {
        const curNode = namespace.addFolder(tagNode, {
          browseName: prop,
          nodeId: "s=" + prop
        });
        addOpcObjects(tagobj[prop], curNode, prop);
      }
    }
  }

  function addOpcObjects(arr, node, nodeName) {
    arr.forEach(item => {
      const device = namespace.addObject({
        organizedBy: node,
        nodeId: "s=" + nodeName + "|" + item.dn,
        browseName: item.dn,
        displayName: item.name + " (" + item.dn + ")"
      });
      for (const property in item.props) {
        if (item.props[property].op == 'calc' || item.props[property].op == 'par' || item.props[property].op == 'rw' || item.props[property].op == 'evnt') {
          let dataType = {};
          if (item.props[property].vtype == 'N') { dataType.s = 'Double'; dataType.obj = DataType.Double; }
          if (item.props[property].vtype == 'S') { dataType.s = 'String'; dataType.obj = DataType.String; }
          if (item.props[property].vtype == 'B') { dataType.s = 'Boolean'; dataType.obj = DataType.Boolean; }
          namespace.addVariable({
            componentOf: device,
            nodeId: "s=" + nodeName + "|" + item.dn + "." + property,
            browseName: property + " (" + item.dn + ")",
            dataType: dataType.s,
            description: item.props[property].name,
            value: {
              get: () => new Variant({ dataType: dataType.obj, value: dataType.s == 'Boolean' ? filter.devices[item._id + "." + property].value == 1 ? true : false : filter.devices[item._id + "." + property].value }),
              set: (variant) => {
                if (variant.dataType == 1) {
                  filter.devices[item._id + "." + property].value = variant.value == true ? 1 : 0;
                }
                if (variant.dataType == 11) {
                  filter.devices[item._id + "." + property].value = parseFloat(variant.value);
                }
                if (variant.dataType == 12) {
                  filter.devices[item._id + "." + property].value = String(variant.value);
                }
                plugin.send({ type: 'command', command: 'setval', did: item._id, prop: property, value: filter.devices[item._id + "." + property].value });
                return StatusCodes.Good;
              }
            }
          });
        }
        if (item.props[property].op == 'cmd') {
          const method = namespace.addMethod(device, {
            componentOf: device,
            nodeId: "s=" + nodeName + "|" + item.dn + "." + property,
            browseName: property + "()" + " (" + item.dn + ")",
            description: item.props[property].name
          });
          method.bindMethod((callback) => {
            plugin.send({ type: 'command', command: 'device', did: item._id, prop: property });
            const callMethodResult = {
              statusCode: StatusCodes.Good
            };
            callback(null, callMethodResult);
          });
        }
      }
    })
  }


  function subExtraChannels(filter) {
    plugin.onSub('devices', filter, data => {
      plugin.log("data" + util.inspect(data), 2);
      data.forEach(item => {
        if (filter.devices[item.did + '.' + item.prop] != undefined) {
          filter.devices[item.did + '.' + item.prop].value = item.value;
        }
      });
    })
  }

  plugin.onChange('extra', async (recs) => {
    plugin.log('onChange addExtra ' + util.inspect(recs), 2);
    let curfilter = {
      did_prop: [],
      devices: {},
      locationobj: {},
      tagobj: {},
      deviceobj: {}
    }
    let curdevices = [];
    for (let index = 0; index < recs.length; index++) {
      if (recs[index].op == 'add') {
        if (recs[index].filter == 'location') {
          const location = recs[index].locationStr
          const devices = await plugin.devices.get({ location: location});
          const group = groupBy(devices, 'location');
          curfilter.locationobj[location] = group;
          curdevices.push(...devices);          
          addOpcLocation(curfilter.locationobj);
        }

        curdevices.forEach(item => {
          for (const property in item.props) {
            curfilter.did_prop.push(item._id + "." + property);
            curfilter.devices[item._id + "." + property] = item.props[property];
          }
        })
        subExtraChannels(curfilter);
        
      }
    }
    //plugin.log('filter ' + util.inspect(filter.locationobj, null, 4));
    //const addExtra = filterExtraChannels(recs);
    /*for (const prop in filter.locationobj) { 
      for (const prop1 in filter.locationobj[prop]) { 
        plugin.log('NodeId ' + filter.locationobj[prop][prop1])
      
      }
      
    }*/
    //namespace.deleteNode(devicesNode);


    //filter = await filterExtraChannels(extraChannels);


//    subExtraChannels(filter);
  });

  server.start(function () {
    plugin.log("Server is now listening ... ", 1);
    plugin.log("port " + server.endpoints[0].port, 1);
    const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
    plugin.log(" the primary server endpoint url is " + endpointUrl, 1);
  });
  // set the server to answer for modbus requests


  process.on('exit', terminate);
  process.on('SIGTERM', () => {
    terminate();
    process.exit(0);
  });

  function terminate() {
    console.log('TERMINATE PLUGIN');
    // Здесь закрыть все что нужно
  }

  async function filterExtraChannels(channels) {
    let res = {
      did_prop: [],
      devices: {},
      devicesobj: {},
      locationobj: {},
      tagobj: {}
    };

    const groupchannels = groupBy(channels, 'filter');
    for (const element in groupchannels) {
      let curdevices = [];
      if (element == 'device') {
        const devices = await plugin.devices.get({ did: groupchannels[element].didarr });
        res.devicesobj["Devices"] = devices;
        curdevices.push(...devices);
      }
      if (element == 'location') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const location = groupchannels[element].ref[i].locationStr
          const devices = await plugin.devices.get({ location: location });
          const group = groupBy(devices, 'location');
          res.locationobj[location] = group;
          curdevices.push(...devices);
        }
      }
      if (element == 'tag') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const tag = groupchannels[element].ref[i].tagStr;
          const devices = await plugin.devices.get({ tag: tag });
          res.tagobj[tag] = [];
          res.tagobj[tag].push(...devices);
          curdevices.push(...devices);
        }
      }
      curdevices.forEach(item => {
        for (const property in item.props) {
          res.did_prop.push(item._id + "." + property);
          res.devices[item._id + "." + property] = item.props[property];
        }
      })
    }
    //plugin.log(" res " + util.inspect(res, null, 4));
    return res
  }

  function groupBy(objectArray, property) {
    return objectArray.reduce(function (acc, obj) {
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
    // '/place/dg003/dg010/'=> 2
    const arr = loc.split('/');
    return arr.length > 3 ? arr.length - 3 : 0;
  }

  function getParentLocation(loc) {
    // '/place/dg003/dg010/'=> '/place/dg003/'
    return (
      loc
        .split('/')
        .slice(0, -2)
        .join('/') + '/'
    );
  }


};
