/**
 * certmanager.js
 *
 */

// const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { X509Certificate } = require('crypto');

const { OPCUACertificateManager } = require('node-opcua');

module.exports = {
  async start(plugin, pluginbasepath) {
    this.plugin = plugin;
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
    } else {
      await this.certExpDate(certificateFile);
    }
    return this.serverCM;
  },

  async createCertFromManager(serverCM, pluginbasepath) {
    const serverPKIDir = path.join(pluginbasepath, 'pki');
    const certificateFile = path.join(serverPKIDir, 'own/certs/certificate.pem');
    const hostname = os.hostname();
    const ipAddresses = getIpAddresses();

    await serverCM.createSelfSignedCertificate({
      applicationUri: `urn:${hostname}:NodeOPCUA-Server`,
      dns: [hostname],
      ip: ipAddresses,
      outputFile: certificateFile,
      subject: {
        commonName: 'IntraOPC',
        organization: 'Intrastack',
        country: 'RU',
        locality: 'Kazan'
      },
      startDate: new Date(Date.now()),
      validity: 360
    });
    await this.certExpDate(certificateFile);
  },

  async certExpDate(certificateFile) {
    const certificate = await fs.readFile(certificateFile, 'utf8');
    const x509 = new X509Certificate(certificate);
    const expirationDate = new Date(x509.validTo);
    this.plugin.log('✅ Certificate expiration Date. ' + expirationDate.toLocaleString('ru-RU'), 1);
    process.send({ type: 'procinfo', data: { certExpDate: expirationDate.toLocaleString('ru-RU') } });
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
    await this.certExpDate(certificateFile);
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
