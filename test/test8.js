const {
    OPCUAServer,
    SecurityPolicy,
    MessageSecurityMode,
    UserTokenType,
    OPCUAServerEndPoint,
    Variant,
    DataType,
    OPCUACertificateManager,
    StatusCodes
} = require("node-opcua");
const os = require("os");
const path = require("path");
const fs = require("fs").promises;

async function main() {
    // Определяем applicationUri
    const applicationUri = "urn:MyOPCUAServer";

    const serverPKIDir = path.join(__dirname, "../pki");
    
    // Проверка и создание директории PKI
    try {
        await fs.access(serverPKIDir);
    } catch {
        await fs.mkdir(serverPKIDir, { recursive: true });
    }

    // Настройка сертификат-менеджера
    const serverCertificateManager = new OPCUACertificateManager({
        rootFolder: serverPKIDir,
        name: "ServerCertificateManager",
        automaticallyAcceptUnknownCertificate: true
    });

    try {
        // Инициализация сертификат-менеджера
        await serverCertificateManager.initialize();
        console.log("Certificate manager initialized");

        // Пути к сертификату и ключу
        const serverCertificateFile = path.join(serverPKIDir, "own/certs/certificate.pem");
        const serverPrivateKeyFile = path.join(serverPKIDir, "own/private/private_key.pem");
        const serverCertificateDerFile = path.join(serverPKIDir, "own/certs/certificate.der");

        // Проверка наличия сертификата и ключа
        try {
            await fs.access(serverCertificateFile);
            await fs.access(serverPrivateKeyFile);
            console.log("Certificate and private key files found");
        } catch (err) {
            console.error("Certificate or private key not found:", err.message);
            console.log("Expected certificate at:", serverCertificateFile);
            console.log("Expected private key at:", serverPrivateKeyFile);
            throw new Error("Certificate initialization failed - files not found");
        }

        // Преобразование PEM сертификата в DER
        let certificateDER;
        try {
            // Проверяем, существует ли уже DER файл
            try {
                await fs.access(serverCertificateDerFile);
                console.log("✅ DER сертификат уже существует");
                certificateDER = await fs.readFile(serverCertificateDerFile);
            } catch {
                console.log("🔄 Создание DER сертификата из существующего PEM...");
                const pemContent = await fs.readFile(serverCertificateFile, "utf8");
                
                // Преобразуем PEM в DER
                const base64Cert = pemContent
                    .replace(/-----BEGIN CERTIFICATE-----/g, "")
                    .replace(/-----END CERTIFICATE-----/g, "")
                    .replace(/\r?\n|\r/g, "")
                    .trim();
                
                certificateDER = Buffer.from(base64Cert, "base64");
                
                // Сохраняем DER файл для будущего использования
                await fs.writeFile(serverCertificateDerFile, certificateDER);
                console.log("✅ DER сертификат создан из PEM:", serverCertificateDerFile);
            }
        } catch (err) {
            console.error("Failed to convert certificate from PEM to DER:", err.message);
            throw new Error("Certificate conversion error");
        }

        // Чтение приватного ключа
        let privateKeyBuffer;
        try {
            privateKeyBuffer = await fs.readFile(serverPrivateKeyFile);
            console.log("Private key loaded successfully");
            
            // Проверяем формат приватного ключа
            const keyContent = privateKeyBuffer.toString();
            if (!keyContent.includes("-----BEGIN PRIVATE KEY-----") && 
                !keyContent.includes("-----BEGIN RSA PRIVATE KEY-----") &&
                !keyContent.includes("-----BEGIN EC PRIVATE KEY-----")) {
                throw new Error("Invalid private key format: Must be PEM format");
            }
            
        } catch (err) {
            console.error("Failed to read private key:", err.message);
            throw new Error("Private key read error");
        }

        // Конфигурация endpoints
        const endpoints = [
            {
                port: 5004,
                resourcePath: "/UA/MyServer",
                securityPolicy: SecurityPolicy.None,
                securityMode: MessageSecurityMode.None,
                allowAnonymous: true,
                userIdentityTokens: [
                    {
                        policyId: "Anonymous",
                        tokenType: UserTokenType.Anonymous
                    },
                    {
                        policyId: "Username",
                        tokenType: UserTokenType.UserName,
                        securityPolicy: SecurityPolicy.Basic256Sha256
                    },
                    {
                        policyId: "Certificate",
                        tokenType: UserTokenType.Certificate,
                        securityPolicy: SecurityPolicy.Basic256Sha256
                    }
                ]
            },
            {
                //port: 5004,
                resourcePath: "/UA/MyServer/Secure",
                securityPolicy: SecurityPolicy.Basic256Sha256,
                securityMode: MessageSecurityMode.SignAndEncrypt,
                allowAnonymous: false,
                userIdentityTokens: [
                    {
                        policyId: "Username_Secure",
                        tokenType: UserTokenType.UserName,
                        securityPolicy: SecurityPolicy.Basic256Sha256
                    },
                    {
                        policyId: "Certificate_Secure",
                        tokenType: UserTokenType.Certificate,
                        securityPolicy: SecurityPolicy.Basic256Sha256
                    }
                ]
            }
        ];

        // Конфигурация сервера - используем DER для certificateChain
        const serverOptions = {
            port: 5004,
            resourcePath: "/UA/MyServer",
            buildInfo: {
                productName: "MyOPCUAServer",
                buildNumber: "1",
                buildDate: new Date()
            },
            serverInfo: {
                applicationUri: applicationUri,
                productUri: "MyOPCUAServer",
                applicationName: { text: "My OPC UA Server" },
                applicationType: 0 // Server
            },
            endpoints: endpoints,
            certificateChain: certificateDER,        // DER формат
            privateKey: privateKeyBuffer,           // PEM формат (как буфер)
            //serverCertificateManager: serverCertificateManager
        };

        // Создаем сервер
        const server = new OPCUAServer(serverOptions);

        // Обработчики аутентификации
        server.userManager.getUserTokenPolicy = (endpoint) => {
            return endpoint.userIdentityTokens;
        };

        server.userManager.isValidUser = async (session, userIdentityToken, endpoint) => {
            try {
                if (userIdentityToken.tokenType === UserTokenType.Anonymous) {
                    return { statusCode: StatusCodes.Good };
                }
                
                if (userIdentityToken.tokenType === UserTokenType.UserName) {
                    if (userIdentityToken.userName === "admin" && 
                        userIdentityToken.password && 
                        userIdentityToken.password.toString() === "password123") {
                        return { statusCode: StatusCodes.Good, userName: userIdentityToken.userName };
                    }
                    return { statusCode: StatusCodes.BadUserAccessDenied };
                }
                
                if (userIdentityToken.tokenType === UserTokenType.Certificate) {
                    const certificateStatus = await serverCertificateManager.checkCertificate(userIdentityToken.certificateData);
                    if (certificateStatus === StatusCodes.Good) {
                        return { statusCode: StatusCodes.Good };
                    }
                    return { statusCode: certificateStatus };
                }
                
                return { statusCode: StatusCodes.BadIdentityTokenInvalid };
            } catch (err) {
                console.error("Authentication error:", err.message);
                return { statusCode: StatusCodes.BadIdentityTokenRejected };
            }
        };

        // Инициализация сервера
        await server.initialize();
        console.log("Server initialized");

        // Добавление адресного пространства
         const addressSpace = server.engine.addressSpace;
         const namespace = addressSpace.getOwnNamespace();
        
        // const myVariable = namespace.addVariable({
        //     componentOf: addressSpace.rootFolder.objects,
        //     nodeId: "ns=1;s=MyVariable",
        //     browseName: "MyVariable",
        //     dataType: "Double",
        //     value: { 
        //         get: () => new Variant({ 
        //             dataType: DataType.Double, 
        //             value: Math.random() * 100 
        //         }) 
        //     }
        // });

        // Запуск сервера
        await server.start();
        
        console.log("Server is now listening...");
        const endpointUrl = server.getEndpointUrl();
        console.log("The primary server endpoint url is", endpointUrl);
        console.log("Server is running on", os.hostname());
        console.log("endpoints", server.endpoints);
        
    } catch (err) {
        console.error("Server initialization failed:", err);
        process.exit(1);
    }
}

main();