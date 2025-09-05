const { OPCUAServer, OPCUAClient, AttributeIds, MessageSecurityMode, SecurityPolicy, DataType, UserTokenType, OPCUACertificateManager } = require("node-opcua");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { createPrivateKey } = require("crypto");

// Папки и пути для сертификатов
const serverPKIDir = path.join(__dirname, "pki_server");
const clientPKIDir = path.join(__dirname, "pki_client");
const serverCertPath = path.join(serverPKIDir, "own/certs/server_certificate.pem");
const serverKeyPath = path.join(serverPKIDir, "own/private/private_key.pem");
const serverCertDerPath = path.join(serverPKIDir, "own/certs/server_certificate.der");
const clientCertPath = path.join(clientPKIDir, "own/certs/client_certificate.pem");
const clientKeyPath = path.join(clientPKIDir, "own/private/private_key.pem");
const clientCertDerPath = path.join(clientPKIDir, "own/certs/client_certificate.der");

// Динамическое получение applicationUri
function getApplicationUri(isServer = false) {
    const hostname = os.hostname();
    return `urn:${hostname}:NodeOPCUA-${isServer ? "Server" : "Client"}`;
}

// Проверка существования файла
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Генерация сертификатов для сервера
async function initializeServerCertificates() {
    const pkiDir = serverPKIDir;
    const certificateFile = serverCertPath;
    const certificateDerFile = serverCertDerPath;
    const privateKeyFile = serverKeyPath;
    const name = "ServerExample";
    const applicationUri = getApplicationUri(true);
    console.log(`🔍 Application URI for server: ${applicationUri}`);
    
    const cm = new OPCUACertificateManager({
        rootFolder: pkiDir,
        name,
        automaticallyAcceptUnknownCertificate: true
    });

    await cm.initialize();
    console.log(`✅ Серверный PKI инициализирован в ${pkiDir}`);

    if (!(await fileExists(certificateFile))) {
        console.log(`Создаём серверный сертификат с applicationUri: ${applicationUri}`);
        await cm.createSelfSignedCertificate({
            applicationUri,
            subject: `/CN=${name}/O=NodeOPCUA`,
            startDate: new Date(),
            validity: 365 * 24 * 60 * 60 * 1000, // 1 год
            dns: [os.hostname(), "localhost"],
            ip: ["127.0.0.1"],
            outputFile: certificateFile,
        });
        console.log(`✅ PEM сертификат создан: ${certificateFile}`);

        console.log(`🔄 Генерация DER сертификата для сервера...`);
        const pemContent = await fs.readFile(certificateFile, "utf8");
        const base64Cert = pemContent
            .replace(/-----BEGIN CERTIFICATE-----/g, "")
            .replace(/-----END CERTIFICATE-----/g, "")
            .replace(/\r?\n|\r/g, "")
            .trim();
        const derBuffer = Buffer.from(base64Cert, "base64");
        await fs.mkdir(path.dirname(certificateDerFile), { recursive: true });
        await fs.writeFile(certificateDerFile, derBuffer);
        console.log(`✅ DER сертификат создан: ${certificateDerFile}`);
    } else {
        console.log(`✅ PEM сертификат уже существует: ${certificateFile}`);
        if (!(await fileExists(certificateDerFile))) {
            console.log(`🔄 Создание DER сертификата из существующего PEM для сервера...`);
            const pemContent = await fs.readFile(certificateFile, "utf8");
            const base64Cert = pemContent
                .replace(/-----BEGIN CERTIFICATE-----/g, "")
                .replace(/-----END CERTIFICATE-----/g, "")
                .replace(/\r?\n|\r/g, "")
                .trim();
            const derBuffer = Buffer.from(base64Cert, "base64");
            await fs.mkdir(path.dirname(certificateDerFile), { recursive: true });
            await fs.writeFile(certificateDerFile, derBuffer);
            console.log(`✅ DER сертификат создан: ${certificateDerFile}`);
        } else {
            console.log(`✅ DER сертификат уже существует: ${certificateDerFile}`);
        }
    }

    return { certificateFile, privateKeyFile, certificateDerFile, cm };
}

// Генерация сертификатов для клиента
async function initializeClientCertificates() {
    const pkiDir = clientPKIDir;
    const certificateFile = clientCertPath;
    const certificateDerFile = clientCertDerPath;
    const privateKeyFile = clientKeyPath;
    const name = "ClientExample";
    const applicationUri = getApplicationUri(false);
    console.log(`🔍 Application URI for client: ${applicationUri}`);
    
    const cm = new OPCUACertificateManager({
        rootFolder: pkiDir,
        name,
        automaticallyAcceptUnknownCertificate: true
    });

    await cm.initialize();
    console.log(`✅ Клиентский PKI инициализирован в ${pkiDir}`);

    if (!(await fileExists(certificateFile))) {
        console.log(`Создаём клиентский сертификат с applicationUri: ${applicationUri}`);
        await cm.createSelfSignedCertificate({
            applicationUri,
            subject: `/CN=${name}/O=NodeOPCUA`,
            startDate: new Date(),
            validity: 365 * 24 * 60 * 60 * 1000, // 1 год
            dns: [os.hostname(), "localhost"],
            ip: ["127.0.0.1"],
            outputFile: certificateFile,
        });
        console.log(`✅ PEM сертификат создан: ${certificateFile}`);

        console.log(`🔄 Генерация DER сертификата для клиента...`);
        const pemContent = await fs.readFile(certificateFile, "utf8");
        const base64Cert = pemContent
            .replace(/-----BEGIN CERTIFICATE-----/g, "")
            .replace(/-----END CERTIFICATE-----/g, "")
            .replace(/\r?\n|\r/g, "")
            .trim();
        const derBuffer = Buffer.from(base64Cert, "base64");
        await fs.mkdir(path.dirname(certificateDerFile), { recursive: true });
        await fs.writeFile(certificateDerFile, derBuffer);
        console.log(`✅ DER сертификат создан: ${certificateDerFile}`);
    } else {
        console.log(`✅ PEM сертификат уже существует: ${certificateFile}`);
        if (!(await fileExists(certificateDerFile))) {
            console.log(`🔄 Создание DER сертификата из существующего PEM для клиента...`);
            const pemContent = await fs.readFile(certificateFile, "utf8");
            const base64Cert = pemContent
                .replace(/-----BEGIN CERTIFICATE-----/g, "")
                .replace(/-----END CERTIFICATE-----/g, "")
                .replace(/\r?\n|\r/g, "")
                .trim();
            const derBuffer = Buffer.from(base64Cert, "base64");
            await fs.mkdir(path.dirname(certificateDerFile), { recursive: true });
            await fs.writeFile(certificateDerFile, derBuffer);
            console.log(`✅ DER сертификат создан: ${certificateDerFile}`);
        } else {
            console.log(`✅ DER сертификат уже существует: ${certificateDerFile}`);
        }
    }

    return { certificateFile, privateKeyFile, certificateDerFile, cm };
}

// Сервер OPC UA
async function startServer() {
    const { certificateFile, privateKeyFile, certificateDerFile, cm } = await initializeServerCertificates();

    const server = new OPCUAServer({
        port: 26543,
        resourcePath: "/UA/MyServer",
        certificateFile,
        privateKeyFile,
        securityModes: [MessageSecurityMode.SignAndEncrypt],
        securityPolicies: [SecurityPolicy.Basic256Sha256],
        allowAnonymous: false,
        serverCertificateManager: cm,
        /*userTokenPolicy: [
            {
                tokenType: UserTokenType.Certificate,
                securityPolicyUri: SecurityPolicy.Basic256Sha256,
            },
        ],*/
    });

    try {
        await server.initialize();

        const addressSpace = server.engine.addressSpace;
        const namespace = addressSpace.getOwnNamespace();

        namespace.addVariable({
            organizedBy: addressSpace.rootFolder.objects,
            browseName: "MyVariable",
            nodeId: "s=MyVariable",
            dataType: "Double",
            value: { dataType: DataType.Double, value: 42.0 },
        });

        console.log("Сервер инициализирован. Endpoint:", server.endpoints[0].endpointDescriptions()[0].endpointUrl);
        await server.start();
        console.log("Сервер запущен!");
    } catch (err) {
        console.error("Ошибка запуска сервера:", err.message);
        throw err;
    }
}

// Клиент OPC UA
async function startClient() {
    const { certificateFile, privateKeyFile, certificateDerFile, cm } = await initializeClientCertificates();

    // === ДОБАВЛЯЕМ СЕРВЕРНЫЙ СЕРТИФИКАТ В ДОВЕРЕННЫЕ КЛИЕНТА ===


    const client = OPCUAClient.create({
        endpointMustExist: false,
        securityMode: MessageSecurityMode.SignAndEncrypt,
        securityPolicy: SecurityPolicy.Basic256Sha256,
        certificateFile,
        privateKeyFile,
        clientCertificateManager: cm,
        defaultSecureTokenLifetime: 60000,
    });

    const endpointUrl = "opc.tcp://localhost:26543/UA/MyServer";
//const endpointUrl = "opc.tcp://localhost:4334/UA/IntraServer";
    try {
        await client.connect(endpointUrl);
        console.log("Клиент подключен к", endpointUrl);

        const endpoints = await client.getEndpoints();
        console.log("Доступные endpoint'ы:");
        endpoints.forEach((endpoint, index) => {
            console.log(`Endpoint ${index}:`, endpoint.endpointUrl, "UserTokenPolicies:", endpoint.userIdentityTokens);
        });

        const certificateEndpoint = endpoints.find((endpoint) =>
            endpoint.userIdentityTokens.some((policy) => policy.tokenType === UserTokenType.Certificate)
        );
        if (!certificateEndpoint) {
            throw new Error("Не найден endpoint с поддержкой UserTokenType.Certificate");
        }

        // Преобразование приватного ключа в объект ключа
        const privateKeyPem = await fs.readFile(privateKeyFile, "utf8");
        console.log("Содержимое приватного ключа:", privateKeyPem.substring(0, 100) + "...");
        const privateKeyObject = createPrivateKey({
            key: privateKeyPem,
            format: "pem",
           // type: "pkcs8"
        });
        console.log("✅ Приватный ключ успешно преобразован");
        
        // Проверяем, что ключ валиден
        if (privateKeyObject.asymmetricKeyType) {
            console.log(`✅ Тип ключа: ${privateKeyObject.asymmetricKeyType}`);
            console.log(`✅ Размер ключа: ${privateKeyObject.asymmetricKeyDetails?.modulusLength || 'неизвестно'}`);
        }

        // Создание UserIdentityInfo с сертификатом и приватным ключом
        const pemContent = await fs.readFile(certificateDerFile);
        const userIdentityInfo = {
            type: UserTokenType.Certificate,
            certificateData:pemContent,
            privateKey: privateKeyObject,
        };
        console.log("UserIdentityInfo создан:", userIdentityInfo);

        const session = await client.createSession(userIdentityInfo);
        console.log("Сессия создана");

        const dataValue = await session.read({
            nodeId: "ns=1;s=MyVariable",
            attributeId: AttributeIds.Value,
        });
        console.log("Значение MyVariable:", dataValue.value.value);

        await session.close();
        await client.disconnect();
        console.log("Клиент отключен");
    } catch (err) {
        console.error("Ошибка клиента:", err.message);
        throw err;
    }
}

// Запуск сервера и клиента
(async () => {
    try {
        await startServer();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await startClient();
    } catch (err) {
        console.error("Ошибка:", err.message);
    }
})();