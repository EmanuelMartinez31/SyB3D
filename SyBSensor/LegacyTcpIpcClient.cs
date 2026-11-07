using System.Buffers.Binary;
using System.Net.Sockets;
using BlueBottleIPC.LeagueBroadcast.Commands;
using BlueBottleIPC.LeagueBroadcast.Snapshot;
using FlatSharp;

// Cliente del transporte TCP legacy que lblib abre en 127.0.0.1:4998.
// No usa NamedPipe, autenticacion Develop, LeagueBroadcast ni canales /ws/*.
sealed class LegacyTcpIpcClient
{
    private const int Port = 4998;
    private const int MaxMessageSize = 64 * 1024 * 1024;
    private readonly SemaphoreSlim sendLock = new(1, 1);

    public event EventHandler<GameInfo> GameInfoReceived;

    public async Task RunSessionAsync(CancellationToken cancellationToken)
    {
        using var tcp = new TcpClient(AddressFamily.InterNetwork) { NoDelay = true };
        await tcp.ConnectAsync("127.0.0.1", Port, cancellationToken);
        Console.WriteLine("TCP LEGACY CONECTADO en 127.0.0.1:4998.");

        using NetworkStream stream = tcp.GetStream();
        using var session = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var registration = new TaskCompletionSource<Response>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        ulong registrationId = 0;

        Task receiveTask = ReceiveLoopAsync(stream, response =>
        {
            if (response.RequestId == registrationId && registrationId != 0)
                registration.TrySetResult(response);

            if (response.Data.Kind == ResponseKind.ItemKind.GameInfo)
                GameInfoReceived?.Invoke(this, response.Data.GameInfo);
        }, session.Token);

        try
        {
            await SendRequestAsync(stream, new Request
            {
                Data = new RequestKind(new SetClientCapabilities
                {
                    EditorHotkeys = true,
                    KeyboardCapture = false
                })
            }, session.Token);
            Console.WriteLine("Capacidades enviadas por TCP; el servidor mantuvo la conexion.");

            registrationId = (ulong)Random.Shared.NextInt64();
            await SendRequestAsync(stream, new Request
            {
                RequestId = registrationId,
                Data = new RequestKind(new RegisterService
                {
                    Type = ServiceType.LeagueBroadcastLiveSnapshot,
                    Params = new List<string> { "250" }
                })
            }, session.Token);

            Response response = await registration.Task.WaitAsync(
                TimeSpan.FromSeconds(5), session.Token);
            if (response.Data.Kind != ResponseKind.ItemKind.SimpleResponse)
                throw new InvalidDataException(
                    "Registro de snapshots: respuesta " + response.Data.Kind);

            SimpleResponseKind kind = response.Data.SimpleResponse.Kind;
            if (kind != SimpleResponseKind.RegisterSuccess &&
                kind != SimpleResponseKind.GenericSuccess)
                throw new InvalidDataException("Registro de snapshots rechazado: " + kind);

            Console.WriteLine("SNAPSHOTS ACTIVOS POR TCP a 250 ms.");
            await receiveTask;
        }
        finally
        {
            session.Cancel();
            try { await receiveTask; } catch { }
        }
    }

    private async Task SendRequestAsync(
        NetworkStream stream, Request request, CancellationToken cancellationToken)
    {
        await sendLock.WaitAsync(cancellationToken);
        try
        {
            if (request.RequestId == 0)
                request.RequestId = (ulong)Random.Shared.NextInt64();

            int maxSize = Request.Serializer.GetMaxSize(request);
            if (maxSize <= 0 || maxSize > MaxMessageSize)
                throw new InvalidDataException("Tamano de solicitud IPC invalido: " + maxSize);

            byte[] frame = new byte[maxSize + 4];
            int payloadSize = ISerializerExtensions.Write<Request>(
                Request.Serializer, frame.AsSpan(4), request);
            BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(0, 4), (uint)payloadSize);
            await stream.WriteAsync(frame.AsMemory(0, payloadSize + 4), cancellationToken);
        }
        finally
        {
            sendLock.Release();
        }
    }

    private static async Task ReceiveLoopAsync(
        NetworkStream stream, Action<Response> onResponse,
        CancellationToken cancellationToken)
    {
        byte[] lengthBuffer = new byte[4];
        while (!cancellationToken.IsCancellationRequested)
        {
            await ReadExactAsync(stream, lengthBuffer, cancellationToken);
            uint length = BinaryPrimitives.ReadUInt32LittleEndian(lengthBuffer);
            if (length == 0 || length > MaxMessageSize)
                throw new InvalidDataException("Tamano de respuesta IPC invalido: " + length);

            byte[] payload = new byte[length];
            await ReadExactAsync(stream, payload, cancellationToken);
            Response response = ISerializerExtensions.Parse<Response>(
                Response.Serializer, new ReadOnlyMemory<byte>(payload), null);
            onResponse(response);
        }
    }

    private static async Task ReadExactAsync(
        Stream stream, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer[offset..], cancellationToken);
            if (read == 0)
                throw new EndOfStreamException("El servidor TCP cerro la conexion.");
            offset += read;
        }
    }
}
