const opcua = require("node-opcua");
const fs = require("fs");
const path = require("path");

async function simpleClientTest() {
    try {
        console.log("🔐 Простой тест клиента с аутентификацией X509...");

        // Указываем applicationUri
        const applicationUri = 'urn:SimpleClient:NodeOPCUA';
        console.log("Используемый Application URI:", applicationUri);

        // Путь к PKI директории клиента
        const clientPKIDir = path.join(__dirname, "client_pki");

        // Создаем директорию, если не существует
        if (!fs.existsSync(clientPKIDir)) {
            fs.mkdirSync(clientPKIDir, { recursive: true });
        }

        // Создаем менеджер сертификатов
        const clientCM = new opcua.OPCUACertificateManager({
            rootFolder: clientPKIDir,
            name: "SimpleClientPKI"
        });

        await clientCM.initialize();

        const certificateFile = path.join(clientPKIDir, "own/certs/client_cert.pem");
        const privateKeyFile = path.join(clientPKIDir, "own/private/private_key.pem");

        // Создаем самоподписанный сертификат, если он не существует
        if (!fs.existsSync(certificateFile)) {
            console.log("Создаем самоподписанный сертификат...");
            await clientCM.createSelfSignedCertificate({
                applicationUri: applicationUri,
                subject: "/CN=SimpleClient/O=NodeOPCUA",
                startDate: new Date(),
                validity: 365 * 24 * 60 * 60 * 1000, // 1 год
                dns: ["localhost"],
                ip: ["127.0.0.1"],
                outputFile: certificateFile,
                privateKeyFile: privateKeyFile
            });
            console.log("✅ Сертификат и ключ созданы");
        } else {
            console.log("✅ Сертификат уже существует");
        }

        // Загружаем сертификат и приватный ключ
        const certificate = fs.readFileSync(certificateFile);
        const privateKey = fs.readFileSync(privateKeyFile);

        console.log("✅ Сертификаты загружены");
        console.log("📁 PEM файл:", certificateFile);
        console.log("🔑 Приватный ключ:", privateKeyFile);

        // Создаем клиента
        const client = opcua.OPCUAClient.create({
            endpointMustExist: false,
            securityMode: opcua.MessageSecurityMode.SignAndEncrypt,
            securityPolicy: opcua.SecurityPolicy.Basic256Sha256,
            applicationName: "SimpleClient",
            clientCertificate: certificate,
            clientPrivateKey: privateKey,
            certificateManager: clientCM // Для проверки сертификата сервера
        });

        console.log("🔌 Подключение к серверу...");
        await client.connect("opc.tcp://localhost:5004");
        console.log("✅ Подключено к серверу!");

        // Проверяем доступные endpoints
        console.log("🔍 Проверка endpoints сервера...");
        const endpoints = await client.getEndpoints();
        console.log("Endpoints:", JSON.stringify(endpoints.map(ep => ({
            endpointUrl: ep.endpointUrl,
            securityMode: ep.securityMode,
            securityPolicyUri: ep.securityPolicyUri,
            userIdentityTokens: ep.userIdentityTokens
        })), null, 2));

        // Аутентификация по сертификату X.509
        const userIdentity = {
            type: 2,
            certificateData: certificate
        };

        console.log("🆕 Создание сессии с аутентификацией по сертификату...");
        console.log("UserIdentity:", userIdentity);
        const session = await client.createSession(userIdentity);
        console.log("✅ Сессия создана!");

        // Тест чтения переменной
        console.log("🔍 Тест чтения переменной...");
        const dataValue = await session.readVariableValue("ns=1;s=MyVariable");
        console.log("✅ Значение переменной:", dataValue.value.value);

        // Тест записи переменной
        console.log("✏️ Тест записи переменной...");
        await session.write({
            nodeId: "ns=1;s=MyVariable",
            attributeId: opcua.AttributeIds.Value,
            value: {
                value: {
                    dataType: opcua.DataType.Double,
                    value: 555.55
                }
            }
        });
        console.log("✅ Запись выполнена успешно!");

        // Проверка записи
        const newValue = await session.readVariableValue("ns=1;s=MyVariable");
        console.log("✅ Новое значение:", newValue.value.value);

        await session.close();
        await client.disconnect();
        console.log("🎉 Все операции выполнены успешно!");

    } catch (error) {
        console.error("❌ Ошибка:", error.message);
        if (error.stack) {
            console.error("Stack:", error.stack);
        }
        console.log("\n🔍 Возможные причины:");
        console.log("1. Сертификат клиента не добавлен в доверенные на сервере (pki/trusted/certs)");
        console.log("2. Сертификат сервера не добавлен в доверенные на клиенте (client_pki/pki/trusted/certs)");
        console.log("3. Сервер не поддерживает аутентификацию X509");
        console.log("4. Неправильный формат сертификата или ключа");
        console.log("5. Сервер не запущен или недоступен на opc.tcp://localhost:4334");
    }
}

// Запуск теста
console.log("🚀 Запуск простого клиента с X509...");
simpleClientTest();