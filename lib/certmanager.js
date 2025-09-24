/**
 * certmanager.js
 *
 */

// const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { OPCUACertificateManager } = require('node-opcua');

module.exports = {
  async start(plugin, pluginbasepath) {
    const params = plugin.params;

    // const serverPKIDir = path.join(__dirname, 'pki');
    const serverPKIDir = path.join(pluginbasepath, 'pki');
    const certificateFile = path.join(serverPKIDir, 'own/certs/certificate.pem');

    // Проверка и создание директории PKI
    if (!(await fs.access(serverPKIDir).catch(() => false))) {
      await fs.mkdir(serverPKIDir, { recursive: true });
    }
    const certExists = await fs
      .access(certificateFile)
      .then(() => true)
      .catch(() => false);

    this.serverCM = new OPCUACertificateManager({
      name: 'ServerCertificateManager',
      rootFolder: serverPKIDir,
      automaticallyAcceptUnknownCertificate: params.trust_cert == 1 // Для продакшена установить false
    });

    await this.serverCM.initialize();
    if (!certExists) {
      await this.createCert(certificateFile);
    }
    return this.serverCM;
  },

  async createCert(certificateFile) {
    const hostname = os.hostname();
    const ipAddresses = getIpAddresses();
    const certFileRequest = {
      applicationUri: `urn:${hostname}:NodeOPCUA-Server`,
      dns: [hostname],
      ip: ipAddresses, // Используем массив IP-адресов
      outputFile: certificateFile,
      subject: {
        commonName: 'IntraOPC',
        organization: 'Intrastack',
        country: 'RU',
        locality: 'Kazan'
      },
      startDate: new Date(Date.now()),
      validity: 360
    };
    await this.serverCM.createSelfSignedCertificate(certFileRequest);
  }
};

function getIpAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (let iface of Object.values(interfaces)) {
    for (let alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        ips.push(alias.address);
      }
    }
  }
  return ips;
}
