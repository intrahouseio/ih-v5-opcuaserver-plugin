/**
 * app.js
 */
// const util = require('util');

const nodeengine = require('./lib/nodeengine');
const certmanager = require('./lib/certmanager');

const { OPCUAServer, makeRoles, MessageSecurityMode, SecurityPolicy } = require('node-opcua');

module.exports = async function (plugin) {
  const params = plugin.params;
  if (plugin.params.use_password && !plugin.params.password) {
    plugin.params.password = plugin.getPassword(plugin.params, 'password');
  }
  if (plugin.params.use_password_user && !plugin.params.password_user) {
    plugin.params.password_user = plugin.getPassword(plugin.params, 'password_user');
  }

  const userManager = {
    getUserRoles(userName) {
      if (params.use_password == 1) {
        if (userName == params.userName) return makeRoles('SecurityAdmin');
      }
      if (params.use_password_user == 1) {
        if (userName == params.userName_user) return makeRoles('AuthenticatedUser');
      }
      if (params.use_cert == 1) {
        if (userName == params.cert_clientName) return makeRoles('SecurityAdmin');
      }
      return makeRoles('AuthenticatedUser');
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

  const serverCM = await certmanager.start(plugin, plugin.opt.pluginbasepath + "/" + plugin.opt.id || __dirname);

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
      buildDate: new Date(2025, 8, 29)
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
  server.on('createSession', session => {
    plugin.log('🆕 Создана сессия:' + session.sessionName || 'unnamed', 2);
  });

  server.on('session_activated', session => {
    const token = session.userIdentityToken;
    let user = 'anonymous';
    if (token?.userName) user = token.userName;
    if (token?.certificateData) user = 'certificate user';
    plugin.log('✅ Активирована сессия для пользователя:' + user, 2);
  });

  server.on('session_closed', (session, reason) => {
    plugin.log('🔚 Закрыта сессия:', reason);
  });

  server.on('session_authentication_failed', (session, reason) => {
    plugin.log('❌ Ошибка аутентификации:' + reason.message || reason, 2);
  });

  nodeengine(plugin, server.engine.addressSpace);

 plugin.onCommand(async message => {
    //plugin.log('Get command ' + util.inspect(message), 1);
    if (message.param == 'gencert') {
      try {
        plugin.log('🔄 Generating new certificate...', 1);
        await certmanager.createCertFromManager(serverCM,  plugin.opt.pluginbasepath + "/" + plugin.opt.id || __dirname);
        plugin.log('✅ New certificate generated successfully.', 1);
        process.exit(0);
      } catch (err) {
        plugin.log('❌ Error generating certificate: ' + err.message, 1);
      }
    }
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });
};
