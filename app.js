const util = require('util');
const tools = require('./tools');
const { OPCUAServer, Variant, DataType, StatusCodes } = require("node-opcua");

module.exports = async function (plugin) {
  const params = plugin.params;
  let extraChannels = await plugin.extra.get();
  let filter = await filterExtraChannels(extraChannels);
  const server = new OPCUAServer({
    port: parseInt(params.port) || 4334, // the port of the listening socket of the server
    resourcePath: params.sourcepath || "/UA/IntraServer", // this path will be added to the endpoint resource name
    buildInfo: {
      productName: "IntraServer",
      buildNumber: "7658",
      buildDate: new Date(2014, 5, 2)
    }
  });
  await server.initialize();
  plugin.log("initialized");
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();
  const objectsFolder = addressSpace.rootFolder.objects;


  // declare a new objects
  const devicesNode = namespace.addFolder(objectsFolder, { browseName: "Devices" });
  const locationNode = namespace.addFolder(objectsFolder, { browseName: "Location" });
  const tagNode = namespace.addFolder(objectsFolder, { browseName: "Tag" });


  addOpcDevices(filter.devicesarr, devicesNode);
  addOpcDevices(filter.tagarr, tagNode);
  addOpcDevices(filter.locationarr, locationNode);
 
  subExtraChannels(filter);

  function addOpcDevices(arr, node) {

    arr.forEach(item => {
      const device = namespace.addObject({
        organizedBy: node,
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
    /*extraChannels = await plugin.extra.get();
    filter = filterExtraChannels(extraChannels)
    subExtraChannels(filter);
    addOpcDevices(filter.devicesarr, devicesNode);
    addOpcDevices(filter.tagarr, tagNode);
    addOpcDevices(filter.locationarr, locationNode);*/
  });

  server.start(function () {
    plugin.log("Server is now listening ... ");
    plugin.log("port " + server.endpoints[0].port);
    const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
    plugin.log(" the primary server endpoint url is " + endpointUrl);
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
      devicesarr: [],
      locationarr: [],
      tagarr: []
    };
    
    const groupchannels = groupBy(channels, 'filter');
    for (const element in groupchannels) {
      let curdevices = [];
      if (element == 'device') {
        const devices = await plugin.devices.get({ did: groupchannels[element].didarr });
        plugin.log("devices " + util.inspect(devices, null, 4));
        res.devicesarr = devices;
        curdevices.push(...devices);
      }
      if (element == 'location') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const devices = await plugin.devices.get({ location: groupchannels[element].ref[i].locationStr });
          res.locationarr.push(...devices);
          curdevices.push(...devices);
        }
      }
      if (element == 'tag') {
        for (let i = 0; i < groupchannels[element].ref.length; i++) {
          const devices = await plugin.devices.get({ tag: groupchannels[element].ref[i].tagStr });
          res.tagarr.push(...devices);
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

};
