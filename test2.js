const opcua = require("node-opcua");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function construct_address_space(server, start) {
    const addressSpace = server.engine.addressSpace;
    const objectsFolder = addressSpace.rootFolder.objects;
    const namespace = addressSpace.getOwnNamespace();
    let firstNode = namespace.addFolder(objectsFolder, {
        browseName: "Test",
        nodeId: 's=' + "test"
      });
    let vessel = namespace.addObject({
        browseName: "Vessel",
        organizedBy: firstNode
    });
    let l = 0;
    let k = 0;
    let curTime = start;
    for(let i = 0; i<80000; i++) {
        if (k == 400) {
            firstNode = namespace.addFolder(objectsFolder, {
                browseName: "Test"+ i,
                nodeId: 's=' + "test" + i
              });
            k=0;        
        }
        k++
        if (l == 2) {
            vessel = namespace.addObject({
                browseName: "Vessel"+i,
                organizedBy: firstNode
            });
            /*vessel = namespace.addFolder(firstNode, {
                browseName: "Vessel" +i,
                nodeId: 's=' + "Vessel" +i
              });*/
            console.log(`Time elapsed: i=${i} ${Date.now() - curTime} ms`);
            curTime= Date.now();
            //await sleep(1000)    
            l =0;    
        } 
            l++;
        
        const vesselPressure = namespace.addAnalogDataItem({
            browseName: "Pressure",
            engineeringUnitsRange: {
                low: 0,
                high: 10.0
            },
            engineeringUnits: opcua.standardUnits.bar,
            componentOf: vessel,
        });
    }
    
    /*const mym = {
        extractDataValues: () => {
            console.log("Test")
        },
        push: () => {
            return Promise.resolve()
        }
    }
    

    class myHistorian extends opcua.VariableHistorian {
        extractDataValues(historyReadRawModifiedDetails, maxNumberToExtract, isReversed, reverseDataValue, callback) {
            console.log("test23")
            callback(null, 10)
        }
      }
    /*mym.extractDataValues = function (historyReadRawModifiedDetails, maxNumberToExtract, isReversed, isReversed, callback) {
        console.log("test")
        callback(null, 10)
    }

    const mym = new myHistorian(vesselPressure, {
        maxOnlineValues: 1000
    });


    addressSpace.installHistoricalDataNode(vesselPressure, {historian :mym});
    // simulate pressure change
    let t = 0;
    setInterval(function () {
        let value = (Math.sin(t / 50) * 0.7 + Math.random() * 0.2) * 5.0 + 5.0;
        vesselPressure.setValueFromSource({ dataType: "Double", value: value });
        t = t + 1;
    }, 200);*/
}

(async () => {
    try {
        // Let's create an instance of OPCUAServer
        const server = new opcua.OPCUAServer({
            port: 26543, // the port of the listening socket of the server
            resourcePath: "/UA/MyLittleServer", // this path will be added to the endpoint resource name
            nodeset_filename: [opcua.nodesets.standard]
        });
        const start = Date.now();
       
        console.log(`Time elapsed: ${Date.now() - start} ms`);
        await server.initialize();
        console.log("certificateFile = ", server.certificateFile);
        console.log("privateKeyFile  = ", server.privateKeyFile);
        console.log("rejected folder = ", server.serverCertificateManager.rejectedFolder);
        console.log("trusted  folder = ", server.serverCertificateManager.trustedFolder);
        construct_address_space(server, start);
        
        console.log(`Time elapsed: ${Date.now() - start} ms`);
        await server.start();
        console.log("Server is now listening ... ( press CTRL+C to stop)");
        console.log("port ", server.endpoints[0].port);
        const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
        console.log(" the primary server endpoint url is ", endpointUrl);

        
    } catch (err) {
        console.log("Error = ", err);
    }
})();