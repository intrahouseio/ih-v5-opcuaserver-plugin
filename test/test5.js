const fs = require("fs").promises;
const path = require("path");
const {
    opcua,
    OPCUAServer,
    OPCUACertificateManager,
    nodesets,
    Variant,
    DataType,
    UserTokenType,
    MessageSecurityMode,
    SecurityPolicy,
    StatusCodes,
    UserManager,
    makeRoles
} = require("node-opcua");
const os = require("os");
const util = require("util");
process.env.NODEOPCUADEBUG = "CLIENT{TRACE},SERVER{TRACE},SECURITY{TRACE}";
// Проверка версии node-opcua
const nodeOpcuaVersion = require("node-opcua/package.json").version || "unknown";
console.log(`🔍 Версия node-opcua: ${nodeOpcuaVersion}`);

async function startServer() {
    const serverPKIDir = path.join(__dirname, "server_pki");

    // Проверка и создание директории PKI
    if (!await fs.access(serverPKIDir).catch(() => false)) {
        await fs.mkdir(serverPKIDir, { recursive: true });
    }

    const serverCM = new OPCUACertificateManager({
        name: "ServerCertificateManager",
        rootFolder: serverPKIDir,
        automaticallyAcceptUnknownCertificate: true // Для продакшена установить false
    });

    await serverCM.initialize();

    const users = [
        { username: "admin", password: "secret", role: "admin" },
        { username: "operator", password: "pass123", role: "operator" }
    ];



    const userTokenPolicies = [
        {
            policyId: "AnonymousPolicy",
            tokenType: UserTokenType.Anonymous,
            securityPolicyUri: "http://opcfoundation.org/UA/SecurityPolicy#None"
        },
        {
            policyId: "UsernamePolicy",
            tokenType: UserTokenType.UserName,
            securityPolicyUri: "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256"
        },
        {
            policyId: "CertificatePolicy",
            tokenType: UserTokenType.Certificate,
            securityPolicyUri: "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256"
        }
    ];

    const server = new OPCUAServer({
        port: 26543,
        nodeset_filename: [nodesets.standard],
        securityPolicies: [SecurityPolicy.None, SecurityPolicy.Basic256Sha256],
        securityModes: [MessageSecurityMode.None, MessageSecurityMode.Sign, MessageSecurityMode.SignAndEncrypt],
        serverCertificateManager: serverCM,
        clientCertificateManager: serverCM,
        userTokenPolicies: [
            UserTokenType.Anonymous, // Allow anonymous access
            UserTokenType.UserName   // Allow username/password authentication
        ],
        userIdentityTokens: 1,
        userManager : {
            isValidUser: async (session, username, password) => {
                const token = session.userIdentityToken;
                console.log(token)
                if (token?.tokenType === UserTokenType.CERTIFICATE) {
                    // Для X509 аутентификации
                    const cn = extractCNFromCertificate(token.userCertificate);

                    // СОХРАНЯЕМ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
                    session.user = {
                        username: cn,
                        authMethod: "x509",
                        roles: getRolesForCertificateUser(cn),
                        permissions: getPermissionsForUser(cn)
                    };

                    return true; // или проверяем, есть ли такой пользователь в системе
                }

                // Обработка других типов аутентификации...
                return true;
            }
        },
        serverInfo: {
            applicationUri: "urn:" + os.hostname() + ":NodeOPCUA-Server",
            productUri: "urn:NodeOPCUA:Server",
            applicationName: { text: "Fixed Test OPC UA Server" }
        }
    });



    // Функция для извлечения Common Name из сертификата
    function extractCommonNameFromCertificate(certificate) {
        // В реальном приложении используйте библиотеку для парсинга сертификатов
        // Например: const forge = require('node-forge');
        // Это упрощенный пример

        try {
            // Здесь должен быть код для извлечения CN из сертификата
            // Возвращаем заглушку для примера
            return "admin-client";
        } catch (error) {
            console.error("Error parsing certificate:", error);
            return "unknown";
        }
    }

    await server.initialize();

    console.log("✅ Сервер инициализирован");

    const addressSpace = server.engine.addressSpace;
    const namespace = addressSpace.getOwnNamespace();

    const myDevice = namespace.addObject({
        organizedBy: addressSpace.rootFolder.objects,
        browseName: "MyTestDevice"
    });

    let testVariable = 42.0;
    namespace.addVariable({
        componentOf: myDevice,
        nodeId: "ns=1;s=MyVariable",
        browseName: "MyVariable",
        dataType: "Double",
        minimumSamplingInterval: 100,
        value: {
            get: () => new Variant({ dataType: DataType.Double, value: testVariable }),
            set: (variant) => {
                testVariable = parseFloat(variant.value);
                return StatusCodes.Good;
            }
        }
    });

    await server.start();
    console.log("🚀 Исправленный сервер OPC UA запущен!");
    console.log("🌐 Endpoint URL:", server.endpoints[0].endpointDescriptions()[0].endpointUrl);
    console.log("🔑 Сервер автоматически доверяет клиентским сертификатам!");

    console.log("\n🔍 Проверка userIdentityTokens в endpoint'ах:");
    server.endpoints.forEach((ep, index) => {
        const descriptions = ep.endpointDescriptions();
        descriptions.forEach(d => {
            console.log(`\nEndpoint ${index + 1}:`);
            //console.log(`\d ${util.inspect(d)}:`);
            console.log(`  Security: ${MessageSecurityMode[d.securityMode]} + ${d.securityPolicyUri}`);
            if (d.userIdentityTokens && d.userIdentityTokens.length > 0) {
                d.userIdentityTokens.forEach(p => {
                    console.log(`    🔐 ${UserTokenType[p.tokenType]} [${p.policyId}] (Security: ${p.securityPolicyUri || "none"})`);
                });
            } else {
                console.log("    ❌ userIdentityTokens отсутствуют!");
            }
        });
    });

    // Обработчики событий
    server.on("createSession", (session) => {
        console.log("🆕 Создана сессия:", session.sessionName || "unnamed");
    });

    server.on("session_activated", (session) => {
        const token = session.userIdentityToken;
        let user = "anonymous";
        if (token?.userName) user = token.userName;
        if (token?.certificateData) user = "certificate user";
        console.log("✅ Активирована сессия для пользователя:", user);
    });

    server.on("session_closed", (session, reason) => {
        console.log("🔚 Закрыта сессия:", reason);
    });

    server.on("session_authentication_failed", (session, reason) => {
        console.error("❌ Ошибка аутентификации:", reason.message || reason);
    });

    server.on("newChannel", (channel) => {
        console.log("🔗 Новое подключение от:", channel.remoteAddress);
    });

    server.on("closeChannel", (channel) => {
        console.log("🔌 Закрыто подключение от:", channel.remoteAddress);
    });

    process.on("SIGINT", async () => {
        console.log("\n🛑 Получен сигнал завершения...");
        await server.shutdown();
        console.log("✅ Сервер остановлен");
        process.exit(0);
    });

    return server;
}

console.log("🔧 Запуск исправленного OPC UA сервера...");
startServer().catch(err => {
    console.error("❌ Ошибка запуска сервера:", err);
    console.error("Stack:", err.stack);
    process.exit(1);
});