const util = require("util");
const opcua_server = require("./app");

(async () => {  
  let plugin;
  try {
    
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi+'/index.js')();
    plugin.log("OPCUA server plugin has started.", 1);
    plugin.params = await plugin.params.get();
    plugin.log('Received params '+ util.inspect(plugin.params));
     // Получить каналы для публикации
     plugin.extraChannels = await plugin.extra.get();
     plugin.log('Received extra channels ' + util.inspect(plugin.extraChannels, null, 4), 1);
    if (plugin.extraChannels.length > 0) {
      plugin.log(`Received ${plugin.extraChannels.length} extra channels...`, 1);
    } else {
      plugin.log('Empty extra channels list!', 1);
      process.exit(2);
    }

    await opcua_server(plugin);
  } catch (err) {
    plugin.exit(8, `Error! Message: ${util.inspect(err)}`, 1);
  }
})();

function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); //
  } catch (e) {
    opt = {};
  }
  return opt;
}