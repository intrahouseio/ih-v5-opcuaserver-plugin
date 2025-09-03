const { OPCUAServer, OPCUACertificateManager, SecurityPolicy, MessageSecurityMode } = require("node-opcua");
const path = require("path");

// Включение отладочных логов
process.env.NODEOPCUA_LOG_LEVEL = "debug";

async function startServer() {
  const certificateFolder = path.join(__dirname, "certificates");
  const certificateFile = path.join(certificateFolder, "own/certs/server_certificate.pem");
  const privateKeyFile = path.join(certificateFolder, "own/private/private_key.pem");

  try {
    // Инициализация менеджера сертификатов
    const serverCertificateManager = new OPCUACertificateManager({
      rootFolder: certificateFolder
    });
    await serverCertificateManager.initialize();
    console.log("Certificate manager initialized");

    // Создание сервера
    const server = new OPCUAServer({
      port: 4334,
      serverInfo: {
        applicationUri: "urn:MacBook-Air-2.local:IntraServer",
        applicationName: { text: "IntraServer", locale: "en" },
        productUri: "NodeOPCUA-IntraServer"
      },
      resourcePath: '/UA/IntraServer',
      certificateFile: certificateFile,
      privateKeyFile: privateKeyFile,
      serverCertificateManager: serverCertificateManager,
      securityPolicies: [SecurityPolicy.Basic256Sha256, SecurityPolicy.Basic128Rsa15, SecurityPolicy.None],
      securityModes: [MessageSecurityMode.SignAndEncrypt, MessageSecurityMode.Sign, MessageSecurityMode.None],
      allowAnonymous: false
    });

    // Автоматическое принятие сертификата клиента (для тестирования)
   // await serverCertificateManager.trustCertificate(path.join(certificateFolder, "own/certs/client_certificate.pem"));

    await server.start();
    console.log("Server running on opc.tcp://MacBook-Air-2.local:4334/UA/IntraServer");
  } catch (err) {
    console.error("Server error:", err);
  }
}

startServer().catch(console.error);