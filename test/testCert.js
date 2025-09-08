
const fs = require("fs").promises;
const path = require("path");
const { 
  OPCUACertificateManager
} = require('node-opcua');
async function main () {
     const serverPKIDir = path.join(__dirname, "pki_test");
  const certificateFile = path.join(serverPKIDir, "own/certs/certificate.pem");
  // Проверка и создание директории PKI
  if (!await fs.access(serverPKIDir).catch(() => false)) {
    await fs.mkdir(serverPKIDir, { recursive: true });
  }
  /*class CustomOPCUACertificateManager extends OPCUACertificateManager {
    CustomOPCUACertificateManager.defaultCertificateSubject = "/O=Intra/L=Cheboksary/C=RU";
  } */
  const serverCM = new OPCUACertificateManager({
    name: "ServerCertificateManager",
    rootFolder: serverPKIDir,
    automaticallyAcceptUnknownCertificate: false // Для продакшена установить false
  });
  
  await serverCM.initialize();
}
main();