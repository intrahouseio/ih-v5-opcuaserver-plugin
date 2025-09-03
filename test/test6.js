// explicit_client.js
const opcua = require("node-opcua");
const fs = require("fs");
const path = require("path");

async function explicitClientTest() {
    try {
        console.log("🔐 Тест клиента с явным applicationUri...");

        // Явно указываем applicationUri
        const applicationUri = 'urn:Air-Maksim:NodeOPCUA-Client';
        console.log("Используемый Application URI:", applicationUri);

        // Путь к PKI директории клиента
        const clientPKIDir = path.join(__dirname, "explicit_client_pki");

        // Создаем директорию если не существует
        if (!fs.existsSync(clientPKIDir)) {
            fs.mkdirSync(clientPKIDir, { recursive: true });
        }

        // Создаем менеджер сертификатов
        const clientCM = new opcua.OPCUACertificateManager({
            rootFolder: clientPKIDir,
            name: "ExplicitClient"
        });

        await clientCM.initialize();

        const certificateFile = path.join(clientPKIDir, "own/certs/explicit_client.pem");
        const privateKeyFile = path.join(clientPKIDir, "own/private/private_key.pem");
        const certificateDerFile = path.join(clientPKIDir, "own/certs/explicit_client.der");

        // Создаем сертификат с явно указанным applicationUri
        if (!fs.existsSync(certificateFile)) {
            console.log("Создаем сертификат с явным applicationUri...");

            await clientCM.createSelfSignedCertificate({
                applicationUri: applicationUri,
                subject: "/CN=ExplicitClient/O=NodeOPCUA",
                startDate: new Date(),
                validity: 365 * 24 * 60 * 60 * 1000,
                dns: ["Air-Maksim", "localhost"],
                ip: ["127.0.0.1"],
                outputFile: certificateFile
            });

            console.log("✅ PEM сертификат создан");

            // ГЕНЕРИРУЕМ DER СЕРТИФИКАТ ДЛЯ ДРУГИХ КЛИЕНТОВ
            console.log("🔄 Генерация DER сертификата для совместимости...");
            const pemContent = fs.readFileSync(certificateFile, "utf8");
            const base64Cert = pemContent
                .replace(/-----BEGIN CERTIFICATE-----/g, "")
                .replace(/-----END CERTIFICATE-----/g, "")
                .replace(/\r?\n|\r/g, "")
                .trim();
            const derBuffer = Buffer.from(base64Cert, "base64");
            fs.writeFileSync(certificateDerFile, derBuffer);
            console.log("✅ DER сертификат создан:", certificateDerFile);

        } else {
            console.log("✅ PEM сертификат уже существует");

            // ЕСЛИ PEM СУЩЕСТВУЕТ, НО DER НЕТ - СОЗДАЕМ DER
            if (!fs.existsSync(certificateDerFile)) {
                console.log("🔄 Создание DER сертификата из существующего PEM...");
                const pemContent = fs.readFileSync(certificateFile, "utf8");
                const base64Cert = pemContent
                    .replace(/-----BEGIN CERTIFICATE-----/g, "")
                    .replace(/-----END CERTIFICATE-----/g, "")
                    .replace(/\r?\n|\r/g, "")
                    .trim();
                const derBuffer = Buffer.from(base64Cert, "base64");
                fs.writeFileSync(certificateDerFile, derBuffer);
                console.log("✅ DER сертификат создан из PEM:", certificateDerFile);
            } else {
                console.log("✅ DER сертификат уже существует");
            }
        }

        // Загружаем сертификаты (используем PEM для node-opcua)
        const certificate = fs.readFileSync(certificateFile);
        const privateKey = fs.readFileSync(privateKeyFile);

        console.log("✅ Сертификаты загружены");
        console.log("📁 PEM файл:", certificateFile);
        console.log("📁 DER файл:", certificateDerFile);
        console.log("🔑 Приватный ключ:", privateKeyFile);

        // СОЗДАЕМ КЛИЕНТА
        const client = opcua.OPCUAClient.create({
            endpointMustExist: false,
            securityMode: opcua.MessageSecurityMode.SignAndEncrypt,
            securityPolicy: opcua.SecurityPolicy.Basic256Sha256,
            applicationName: "ExplicitClient",
            clientCertificate: certificate,
            clientPrivateKey: privateKey,
            certificateManager: clientCM
            // applicationUri будет автоматически взят из сертификата
        });

        console.log("🔌 Подключение к серверу...");
        await client.connect("opc.tcp://localhost:4334/UA/IntraServer");
        console.log("✅ Подключено к серверу!");
        const endpoints = await client.getEndpoints();
        const serverCertificate = endpoints[0].serverCertificate; // Получаем сертификат сервера
        fs.writeFileSync(path.join(clientPKIDir, "certs/trusted/server_certificate.pem"), serverCertificate);
        // АУТЕНТИФИКАЦИЯ ПО СЕРТИФИКАТУ X.509
        const userIdentity = {
            type: 2,
            //certificateData: certificate,
            // privateKey: Buffer.from(privateKey.toString())
        };

        console.log("🆕 Создание сессии с аутентификацией по сертификату...");
        const session = await client.createSession(userIdentity);
        console.log("✅ Сессия создана!");

        // Тест чтения
        console.log("🔍 Тест чтения переменной...");
        const dataValue = await session.readVariableValue("ns=1;s=MyVariable");
        console.log("✅ Значение переменной:", dataValue.value.value);

        // Тест записи
        console.log("✏️  Тест записи переменной...");
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

        // Дополнительная диагностика
        if (error.message.includes("Certificate")) {
            console.log("\n🔍 Проблема с сертификатом:");
            console.log("1. Убедитесь, что сертификат добавлен в доверенные на сервере");
            console.log("2. Проверьте applicationUri в сертификате:", 'urn:Air-Maksim:NodeOPCUA-Client');
            console.log("3. Убедитесь, что сервер настроен принимать сертификаты");
        }

        if (error.message.includes("connection")) {
            console.log("\n🔍 Проблема с подключением:");
            console.log("1. Проверьте, что сервер запущен на localhost:4334");
            console.log("2. Проверьте политики безопасности сервера");
        }
    }
}

// Вспомогательная функция для проверки сертификата
function checkCertificateInfo() {
    try {
        const clientPKIDir = path.join(__dirname, "explicit_client_pki");
        const certificateFile = path.join(clientPKIDir, "own/certs/explicit_client.pem");

        if (fs.existsSync(certificateFile)) {
            const certificateContent = fs.readFileSync(certificateFile, "utf8");
            console.log("\n📋 Информация о сертификате:");
            console.log("Файл:", certificateFile);
            console.log("Размер:", certificateContent.length, "байт");

            // Простая проверка наличия applicationUri в сертификате
            if (certificateContent.includes('urn:Air-Maksim:NodeOPCUA-Client')) {
                console.log("✅ ApplicationUri найден в сертификате");
            } else {
                console.log("⚠️  ApplicationUri не найден в сертификате");
            }
        }
    } catch (error) {
        console.log("Не удалось проанализировать сертификат:", error.message);
    }
}

// Запуск теста
console.log("🚀 Запуск клиента с явным applicationUri...");
//checkCertificateInfo();
explicitClientTest();