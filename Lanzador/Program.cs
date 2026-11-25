using System.Diagnostics;
using System.Net.Http;

namespace SyB3D;

static class Program
{
    // El mismo puerto que usa server.js. Si algún día lo cambias allí, cámbialo aquí.
    private const string Direccion = "http://127.0.0.1:3000/";

    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Process servidor = null;

        // Si ya hay un servidor escuchando (porque lo abriste con iniciar.bat),
        // no se arranca otro: solo se abre la ventana.
        if (!Responde(900))
        {
            var raiz = BuscarRaiz();
            if (raiz == null)
            {
                MessageBox.Show(
                    "No encuentro la carpeta del proyecto.\n\n" +
                    "Este programa tiene que estar dentro de la carpeta de SyB3D+HUD,\n" +
                    "junto a iniciar.bat y server.js.",
                    "SyB3D · Panel de control",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            servidor = LanzarServidor(raiz);
            if (servidor == null)
            {
                MessageBox.Show(
                    "No se pudo arrancar iniciar.bat.\n\n" +
                    "Ábrelo a mano una vez para ver el motivo.",
                    "SyB3D · Panel de control",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }

        Application.Run(new VentanaPanel(Direccion, servidor));

        // Al cerrar la ventana: si el servidor lo arrancamos nosotros, se pregunta.
        if (servidor != null && !servidor.HasExited)
        {
            var respuesta = MessageBox.Show(
                "¿Apagar también el servidor y el sensor?",
                "SyB3D · Panel de control",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);

            if (respuesta == DialogResult.Yes) Apagar(servidor);
        }
    }

    // ¿Hay algo escuchando en el puerto del HUD?
    private static bool Responde(int milisegundos)
    {
        try
        {
            using var cliente = new HttpClient { Timeout = TimeSpan.FromMilliseconds(milisegundos) };
            using var respuesta = cliente.GetAsync(Direccion + "status").GetAwaiter().GetResult();
            return respuesta.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    // Sube desde la carpeta del ejecutable hasta encontrar iniciar.bat + server.js.
    // Se prueban dos puntos de partida: la carpeta del .exe y la carpeta de
    // trabajo. El segundo sirve si alguien mueve el ejecutable pero abre el
    // acceso directo, que lleva su propia carpeta de inicio.
    private static string BuscarRaiz()
    {
        var partidas = new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() };

        foreach (var partida in partidas)
        {
            var carpeta = new DirectoryInfo(partida);

            for (var salto = 0; salto < 8 && carpeta != null; salto++, carpeta = carpeta.Parent)
            {
                var iniciar = Path.Combine(carpeta.FullName, "iniciar.bat");
                var servidor = Path.Combine(carpeta.FullName, "server.js");
                if (File.Exists(iniciar) && File.Exists(servidor)) return carpeta.FullName;
            }
        }

        return null;
    }

    // Se lanza iniciar.bat tal cual, minimizado: así el arranque es exactamente
    // el de siempre (comprueba el entorno, compila el sensor, abre el HUD).
    private static Process LanzarServidor(string raiz)
    {
        try
        {
            var datos = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c iniciar.bat",
                WorkingDirectory = raiz,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Minimized
            };
            return Process.Start(datos);
        }
        catch
        {
            return null;
        }
    }

    // taskkill con /T mata el árbol entero: cmd, node y el sensor de una vez.
    private static void Apagar(Process proceso)
    {
        try
        {
            Process.Start(new ProcessStartInfo("taskkill", $"/PID {proceso.Id} /T /F")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            })?.WaitForExit(5000);
        }
        catch
        {
            // Si ya se había cerrado, no hay nada que hacer.
        }
    }
}
