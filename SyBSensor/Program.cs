using System.IO.Compression;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon;
using Amazon.S3;
using BlueBottleClient.Common.Auth.Config;
using BlueBottleClient.Common.Auth.Providers;
using BlueBottleClient.Common.Auth.Services;
using BlueBottleClient.GameLib.Ingame.Services;
using Farsight;
using Microsoft.Extensions.Logging;

const string SERVER = "http://localhost:3000/sensor";
Console.WriteLine("SyBSensor v12.1 - TCP legacy directo, sin autenticacion IPC");

LeagueConnector.EnableLogging(new ConsoleLoggerFactory());
var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

// LB tambien actualiza lblib para la version exacta del juego. La sesion local
// solo se usa para ese repositorio; no se solicitan features ni se autentica IPC.
CredentialsConfig accountCredentials = StoredCredentials.Load();
if (accountCredentials != null && !accountCredentials.IsValid() &&
    !string.IsNullOrEmpty(accountCredentials.RefreshToken) &&
    accountCredentials.AuthProvider == EmailPasswordAuth.COGNITO_IDENTITY_PROVIDER_NAME)
{
    Console.WriteLine("La sesion local vencio; intentando renovarla para GameLib...");
    try
    {
        var emailAuth = new EmailPasswordAuth(new ConsoleLogger<EmailPasswordAuth>());
        await emailAuth.RefreshToken(accountCredentials);
    }
    catch (Exception ex)
    {
        Console.WriteLine("No se pudo renovar la sesion local: " + ex.Message);
    }
}

if (accountCredentials != null && accountCredentials.IsValid())
{
    var awsCredentials = new FederatedCognitoCredentials(
        "eu-central-1:b8aa8c6c-6e42-4562-9c0d-945b4f5fb63b",
        RegionEndpoint.EUCentral1,
        new ConsoleLogger<FederatedCognitoCredentials>());
    awsCredentials.SetLogin(accountCredentials.AuthProvider, accountCredentials.IdToken);

    var s3Client = new AmazonS3Client(awsCredentials, RegionEndpoint.EUCentral1);
    var gameLibFetcher = new GameLibFetcher(
        new ConsoleLogger<GameLibFetcher>(), s3Client);
    LeagueConnector.EnableGameLibFetching(gameLibFetcher);
    Console.WriteLine("GameLib: comprobacion de lblib por version activada.");
}
else
{
    Console.WriteLine("No hay sesion local utilizable para GameLib; se conservara lblib local.");
}

var jsonOpts = new JsonSerializerOptions
{
    MaxDepth = 64,
    NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals
};
long n = 0;
var ipc = new LegacyTcpIpcClient();
CancellationTokenSource tcpSession = null;

ipc.GameInfoReceived += (s, gi) =>
{
    n++;
    string json;
    try
    {
        json = JsonSerializer.Serialize(gi, jsonOpts);
    }
    catch (Exception ex)
    {
        Console.WriteLine("No se pudo serializar GameInfo: " + ex.Message);
        return;
    }

    Console.WriteLine("[GameInfo #" + n + "] " + json.Length + " bytes");
    _ = SendGameInfoAsync(http, json);
};

LeagueConnector.Injected += (s, e) =>
{
    var current = new CancellationTokenSource();
    CancellationTokenSource previous = Interlocked.Exchange(ref tcpSession, current);
    previous?.Cancel();
    Console.WriteLine("Inyectado; abriendo el canal de datos TCP legacy.");
    _ = RunTcpLoopAsync(ipc, current.Token);
};
LeagueConnector.InjectionFailed += (s, ex) => Console.WriteLine("Inyeccion fallo: " + ex.Message);
LeagueConnector.GameWindowOpened += (s, e) => Console.WriteLine("Ventana v" + e.GameVersion);
LeagueConnector.GameStarted += (s, e) => Console.WriteLine("Juego iniciado.");
LeagueConnector.GameEnded += (s, e) =>
{
    // Este evento tambien se dispara cuando falla el NamedPipe que ya no usamos.
    // No cancelar TCP: su propia lectura detectara el cierre real del juego.
    Console.WriteLine("Farsight cerro su conexion; el canal TCP independiente continua.");
};

LeagueConnector.AutoInject = true;
LeagueConnector.Port = 4998;
Console.WriteLine("Canal de datos: TCP directo; sin NamedPipe, Develop ni LeagueBroadcast.");
Console.WriteLine("Buscando el LoL... (abre el juego DESPUES de arrancar esto)");
_ = LeagueConnector.StartWatchingForGameStart(null);

await Task.Delay(-1);

static async Task RunTcpLoopAsync(
    LegacyTcpIpcClient ipc, CancellationToken cancellationToken)
{
    while (!cancellationToken.IsCancellationRequested)
    {
        try
        {
            await ipc.RunSessionAsync(cancellationToken);
            Console.WriteLine("La sesion TCP termino; reintentando.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            break;
        }
        catch (Exception ex)
        {
            Console.WriteLine("TCP legacy: " + ex.Message + " Reintentando...");
        }

        try { await Task.Delay(750, cancellationToken); }
        catch (OperationCanceledException) { break; }
    }
}

static async Task SendGameInfoAsync(HttpClient http, string json)
{
    try
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await http.PostAsync(SERVER, content);
        if (!response.IsSuccessStatusCode)
        {
            Console.WriteLine("El HUD respondio HTTP " + (int)response.StatusCode + " en /sensor.");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("No se pudo enviar GameInfo al HUD: " + ex.Message);
    }
}

static class StoredCredentials
{
    public static CredentialsConfig Load()
    {
        string path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BlueBottle", "LeagueBroadcast", "data", "Credentials.bbd");

        if (!File.Exists(path))
        {
            Console.WriteLine("No se encontro una sesion local de LeagueBroadcast.");
            return null;
        }

        try
        {
            byte[] compressed;
            using (var file = new FileStream(
                path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete))
            using (var memory = new MemoryStream())
            {
                file.CopyTo(memory);
                compressed = memory.ToArray();
            }

            byte[] json;
            if (compressed.Length >= 2 && compressed[0] == 0x1f && compressed[1] == 0x8b)
            {
                using var input = new MemoryStream(compressed, writable: false);
                using var gzip = new GZipStream(input, CompressionMode.Decompress);
                using var output = new MemoryStream();
                gzip.CopyTo(output);
                json = output.ToArray();
            }
            else
            {
                json = compressed;
            }

            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            CredentialsConfig credentials =
                JsonSerializer.Deserialize<CredentialsConfig>(json, options);
            Console.WriteLine("Sesion local leida sin modificar el archivo original.");
            return credentials;
        }
        catch (Exception ex)
        {
            Console.WriteLine("No se pudo leer la sesion local (" + ex.GetType().Name + ").");
            return null;
        }
    }
}

class ConsoleLogger<T> : ILogger<T>
{
    public IDisposable BeginScope<TState>(TState s) => null;
    public bool IsEnabled(LogLevel l) => true;
    public void Log<TState>(LogLevel level, EventId id, TState state, Exception ex,
        Func<TState, Exception, string> fmt)
        => Console.WriteLine("   [" + level + "] " + fmt(state, ex));
}

class ConsoleLogger : ILogger
{
    public IDisposable BeginScope<TState>(TState s) => null;
    public bool IsEnabled(LogLevel l) => true;
    public void Log<TState>(LogLevel level, EventId id, TState state, Exception ex,
        Func<TState, Exception, string> fmt)
        => Console.WriteLine("   [" + level + "] " + fmt(state, ex));
}

class ConsoleLoggerFactory : ILoggerFactory
{
    public ILogger CreateLogger(string category) => new ConsoleLogger();
    public void AddProvider(ILoggerProvider provider) { }
    public void Dispose() { }
}
