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


  // declare a new object
  const devicesNode = namespace.addFolder(objectsFolder, { browseName: "Devices" });
  const locationNode = namespace.addFolder(objectsFolder, { browseName: "Location" });
  const tagNode = namespace.addFolder(objectsFolder, { browseName: "Tag" });

 
  addOpcDevices(namespace);
  /*
  // add some variables
  // add a variable named MyVariable1 to the newly created folder "MyDevice"
  let variable1 = 1;

  // emulate variable1 changing every 500 ms
  setInterval(() => {
    variable1 += 1;
  }, 500);

  namespace.addVariable({
    componentOf: device,
    browseName: "MyVariable1",
    dataType: "Double",
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: variable1 })
    }
  });

  // add a variable named MyVariable2 to the newly created folder "MyDevice"
  let variable2 = 10.0;

  namespace.addVariable({
    componentOf: device,
    nodeId: "ns=1;b=1020FFAA", // some opaque NodeId in namespace 4
    browseName: "MyVariable2",
    dataType: "Double",
    minimumSamplingInterval: 1234, // we need to specify a minimumSamplingInterval when using a getter
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: variable2 }),
      set: (variant) => {
        variable2 = parseFloat(variant.value);
        return StatusCodes.Good;
      }
    }
  });
  const os = require("os");

  function available_memory() {
    // var value = process.memoryUsage().heapUsed / 1000000;
    const percentageMemUsed = (os.freemem() / os.totalmem()) * 100.0;
    return percentageMemUsed;
  }
  namespace.addVariable({
    componentOf: device,

    nodeId: "s=free_memory", // a string nodeID
    browseName: "FreeMemory",
    dataType: "Double",
    value: {
      get: () => new Variant({ dataType: DataType.Double, value: available_memory() })
    }
  });
  */

  subExtraChannels(filter);

  function addOpcDevices(namespace) {
    
    filter.devicesarr.forEach(item => {
      const device = namespace.addObject({
        organizedBy: devicesNode,
        browseName: item.dn,
        displayName: item.name
      });

      for (const property in item.props) {
        if (item.props[property].op == 'calc' || item.props[property].op == 'par' || item.props[property].op == 'rw') {
          let dataType = {};
          let valueProp;
          if (item.props[property].vtype == 'N') { dataType.s = 'Double'; dataType.obj = DataType.Double; }
          if (item.props[property].vtype == 'S') { dataType.s = 'String'; dataType.obj = DataType.String; }
          if (item.props[property].vtype == 'B') { dataType.s = 'Boolean'; dataType.obj = DataType.Boolean; }
          plugin.log("devices " + util.inspect(filter, null, 4));
          if (dataType.s == 'Boolean') {
            valueProp = filter.devices[item._id + "." + property].value == 1 ? true : false;
          } else {
            valueProp = filter.devices[item._id + "." + property].value
          }
          plugin.log("valueProp " + util.inspect(filter.devices[item._id + "." + property].value, null, 4));
          namespace.addVariable({
            componentOf: device,
            browseName: property,
            dataType: dataType.s,
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
        //if (filter.location[item.did + '.' + item.prop] != undefined) filter.location[item.did + '.' + item.prop].value = item.value;
        //if (filter.tag[item.did + '.' + item.prop] != undefined) filter.tag[item.did + '.' + item.prop].value = item.value;
      });
      
    })
  }

  plugin.onChange('extra', async (recs) => {
    plugin.log('onChange addExtra ' + util.inspect(recs), 2);
    extraChannels = await plugin.extra.get();
    filter = filterExtraChannels(extraChannels)
    subExtraChannels(filter);
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
    let res = { did_prop: [] };
    const groupchannels = groupBy(channels, 'filter');
    for (const element in groupchannels) {
      if (element == 'device') {
        const devices = await plugin.devices.get({ did: groupchannels[element].didarr });
        plugin.log("devices " + util.inspect(devices, null, 4));
        res.devices = {};
        res.devicesarr = devices;
        devices.forEach(item => {
          for (const property in item.props) {
            res.did_prop.push(item._id + "." + property);
            res.devices[item._id + "." + property] = item.props[property];
          }
        })
      }
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
