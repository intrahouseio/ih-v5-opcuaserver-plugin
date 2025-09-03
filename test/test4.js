const {
    OPCUAServer,
    OPCUACertificateManager,
    SecurityPolicy,
    MessageSecurityMode
} = require("node-opcua");

// Импортируем нужные функции из node-opcua-crypto
const {
    generatePrivateKey,
    privateKeyToPEM,
    createSelfSignedCertificate
} = require("node-opcua-crypto");

const fs = require("fs");
const path = require("path");

// Пути
const certificateFolder = path.join(__dirname, "certificates");
const clientCertsOutput = path.join(__dirname, "client-certs");

const certificateFile = path.join(certificateFolder, "own/certs/server_certificate.pem");
const privateKeyFile = path.join(certificateFolder, "own/private/private_key.pem");

const clientPrivateKeyFile = path.join(clientCertsOutput, "client_private_key.pem");
const clientCertificateFile = path.join(clientCertsOutput, "client_certificate.pem");

const clientApplicationUri = "urn:client:MyOPCUAClient";

async function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function generateClientCertificate() {
    await ensureDir(clientCertsOutput);

    if (fs.existsSync(clientCertificateFile)) {
        console.log("✅ Клиентский сертификат уже существует:", clientCertificateFile);
        return;
    }

    console.log("🔐 Генерация клиентского сертификата через node-opcua-crypto...");

    // 1. Генерация приватного ключа
    const privateKey = await generatePrivateKey();
    const { privPem } = await privateKeyToPEM(privateKey);
    fs.writeFileSync(clientPrivateKeyFile, privPem);
    console.log("🔑 Приватный ключ клиента создан");

    // 2. Чтение CA данных
    const caCertificate = fs.readFileSync(certificateFile);
    const caPrivateKeyPEM = fs.readFileSync(privateKeyFile, "utf-8");

    // 3. Создание сертификата, подписанного CA
    const { cert } = await createSelfSignedCertificate({
        privateKey: caPrivateKeyPEM,       // приватный ключ CA (сервера)
        publicKey: privateKey,             // публичный ключ клиента
        notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        notBefore: new Date(),
        subject: "/CN=OPC UA Client",
        dns: ["localhost"],
        ip: ["127.0.0.1"],
        applicationUri: clientApplicationUri,
        keyUsage: [
            "digitalSignature",
            "keyEncipherment",
            "dataEncipherment"
        ],
        extendedKeyUsage: ["clientAuth"],
        isCA: false,
        issuerCertificate: caCertificate
    });

    fs.writeFileSync(clientCertificateFile, cert);
    console.log("✅ Клиентский сертификат подписан и сохранён");
    console.log("   →", clientCertificateFile);
    console.log("   →", clientPrivateKeyFile);
}

async function startServer() {
    try {
        const serverCertificateManager = new OPCUACertificateManager({
            rootFolder: certificateFolder
        });
        await serverCertificateManager.initialize();
        console.log("✅ Certificate manager initialized");

        // Генерация клиентского сертификата
        await generateClientCertificate();

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
            securityPolicies: [
                SecurityPolicy.Basic256Sha256,
                SecurityPolicy.Basic128Rsa15,
                SecurityPolicy.None
            ],
            securityModes: [
                MessageSecurityMode.SignAndEncrypt,
                MessageSecurityMode.Sign,
                MessageSecurityMode.None
            ],
            allowAnonymous: false
        });

        await server.start();
        console.log("🟢 Server running on opc.tcp://MacBook-Air-2.local:4334/UA/IntraServer");
    } catch (err) {
        console.error("❌ Server error:", err);
    }
}

startServer().catch(console.error);