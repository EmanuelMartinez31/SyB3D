using System.Diagnostics;
using System.Net.Http;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SyB3D;

/// <summary>
/// La ventana del panel. Mientras el servidor arranca se ve un aviso; en cuanto
/// responde, entra el WebView2 y se queda el panel de control.
/// </summary>
public sealed class VentanaPanel : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, Visible = false };

    private readonly Label espera = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 12f),
        ForeColor = Color.FromArgb(140, 155, 181),
        BackColor = Color.FromArgb(5, 8, 16),
        Text = "Abriendo el panel…"
    };

    private readonly string direccion;
    private readonly Process servidor;

    public VentanaPanel(string direccion, Process servidor)
    {
        this.direccion = direccion;
        this.servidor = servidor;

        Text = "SyB3D · Panel de control";
        BackColor = Color.FromArgb(5, 8, 16);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1000, 640);
        Size = new Size(1480, 940);
        KeyPreview = true;

        Controls.Add(web);
        Controls.Add(espera);

        Shown += async (_, _) => await PrepararAsync();
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.F5 && web.Visible) web.CoreWebView2?.Reload();
        };
    }

    private async Task PrepararAsync()
    {
        if (servidor != null)
        {
            espera.Text = "Arrancando el servidor…\r\nLa primera vez puede tardar un poco.";
            var listo = await Task.Run(() => EsperarServidor(TimeSpan.FromSeconds(150)));

            if (!listo)
            {
                espera.Text =
                    "El servidor no ha arrancado.\r\n\r\n" +
                    "Mira la ventana de iniciar.bat: ahí sale el motivo.\r\n" +
                    "Cuando lo arregles, pulsa F5.";
                return;
            }
        }

        await AbrirPanelAsync();
    }

    private static bool EsperarServidor(TimeSpan limite)
    {
        var fin = DateTime.UtcNow + limite;
        while (DateTime.UtcNow < fin)
        {
            try
            {
                using var cliente = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1200) };
                using var respuesta = cliente
                    .GetAsync("http://127.0.0.1:3000/status")
                    .GetAwaiter().GetResult();
                if (respuesta.IsSuccessStatusCode) return true;
            }
            catch
            {
                // Todavía no escucha: se vuelve a probar.
            }

            Thread.Sleep(400);
        }

        return false;
    }

    private async Task AbrirPanelAsync()
    {
        try
        {
            var datos = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SyB3D", "WebView2");
            Directory.CreateDirectory(datos);

            var entorno = await CoreWebView2Environment.CreateAsync(null, datos);
            await web.EnsureCoreWebView2Async(entorno);

            var ajustes = web.CoreWebView2.Settings;
            ajustes.IsStatusBarEnabled = false;
            ajustes.AreDevToolsEnabled = true;          // F12 para depurar, como en el navegador
            ajustes.AreDefaultContextMenusEnabled = true;
            ajustes.IsZoomControlEnabled = true;

            // Los enlaces que abren pestaña nueva (el botón «Abrir» de los enlaces
            // de OBS) se abren en el navegador de Windows, no dentro de la app.
            web.CoreWebView2.NewWindowRequested += (_, evento) =>
            {
                evento.Handled = true;
                try
                {
                    Process.Start(new ProcessStartInfo(evento.Uri) { UseShellExecute = true });
                }
                catch
                {
                    // si el navegador no arranca, no se hace nada
                }
            };

            web.CoreWebView2.NavigationCompleted += (_, evento) =>
            {
                if (!evento.IsSuccess)
                {
                    espera.Text =
                        "No se pudo cargar el panel.\r\n\r\n" +
                        "Comprueba que el servidor sigue encendido y pulsa F5.";
                    espera.Visible = true;
                    web.Visible = false;
                }
            };

            web.Source = new Uri(direccion);
            web.Visible = true;
            espera.Visible = false;
        }
        catch (Exception error)
        {
            espera.Text =
                "No se pudo abrir el panel.\r\n\r\n" + error.Message + "\r\n\r\n" +
                "Si el error habla de WebView2, instala el «Microsoft Edge WebView2 Runtime».";
        }
    }
}
