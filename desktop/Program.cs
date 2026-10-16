using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    private static Icon CreateIcon()
    {
        using (Stream stream = typeof(Program).Assembly.GetManifestResourceStream("app.ico"))
        using (var icon = new Icon(stream))
            return (Icon)icon.Clone();
    }

    internal static int Run(string loaderDirectory, bool test)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(loaderDirectory);
        if (test)
        {
            // Exercise both embedded managed dependencies and the extracted native loader, without UI.
            if (typeof(WebView2).Assembly.Location != "" || typeof(CoreWebView2Environment).Assembly.Location != "")
                throw new InvalidOperationException("WebView2 assemblies were not loaded from embedded resources.");
            using (var icon = CreateIcon())
                if (icon.Width < 16) throw new InvalidOperationException("Missing application icon.");
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (WebView2RuntimeNotFoundException) { /* Building does not require the shared browser runtime. */ }
            return 0;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var icon = CreateIcon())
        using (var window = new MainWindow())
        {
            window.Icon = icon;
            Application.Run(window);
        }
        return 0;
    }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 browser = new WebView2();
    private readonly Uri site = UrlPolicy.Site;

    internal MainWindow()
    {
        Text = "Streamroom — " + site.Host;
        ClientSize = new Size(1200, 800);
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        var menu = new MenuStrip();
        menu.Items.Add("Reload", null, delegate
        {
            if (browser.CoreWebView2 != null) browser.Reload();
        });
        menu.Items.Add("Open in Edge", null, delegate { OpenInEdge(site); });
        menu.Items.Add("About", null, delegate
        {
            using (var about = new Form { Text = "About Streamroom", Icon = Icon, Size = new Size(700, 500),
                StartPosition = FormStartPosition.CenterParent })
            {
                about.Controls.Add(new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true,
                    ScrollBars = ScrollBars.Vertical, Text = "Streamroom\r\nhttps://share.detrouse.com/\r\n\r\n"
                        + Encoding.UTF8.GetString(Bootstrap.ReadResource("WebView2-LICENSE.txt.gz"))
                        + "\r\n\r\n" + Encoding.UTF8.GetString(Bootstrap.ReadResource("WebView2-NOTICE.txt.gz")) });
                about.ShowDialog(this);
            }
        });
        MainMenuStrip = menu;
        browser.Dock = DockStyle.Fill;
        Controls.Add(browser);
        Controls.Add(menu);
        Shown += async delegate
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null,
                    Path.Combine(Bootstrap.DataDirectory, "WebView2"));
                if (IsDisposed) return;
                await browser.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                var core = browser.CoreWebView2;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsWebMessageEnabled = false;
                // Keep the runtime's own permission prompts and screen picker.
                // Never auto-grant microphone or screen access.
                core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
                {
                    Uri target;
                    if (!UrlPolicy.TryParse(e.Uri, out target)) { e.Cancel = true; return; }
                    if (!UrlPolicy.SameOrigin(site, target))
                    {
                        e.Cancel = true;
                        OpenInEdge(target);
                    }
                };
                core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    e.Handled = true;
                    Uri target;
                    if (UrlPolicy.TryParse(e.Uri, out target)) OpenInEdge(target);
                };
                core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e)
                {
                    e.Cancel = true;
                };
                core.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
                {
                    if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        MessageBox.Show(this, "The website could not load (" + e.WebErrorStatus
                            + "). Check your connection and website address, then click Reload.", "Streamroom");
                };
                core.Navigate(site.AbsoluteUri);
            }
            catch (Exception error)
            {
                if (IsDisposed) return;
                MessageBox.Show(this, "WebView2 could not start. Install or repair Microsoft Edge WebView2 Runtime:\n"
                    + "https://developer.microsoft.com/microsoft-edge/webview2/\n\n"
                    + "You can also use Open in Edge above.\n\n" + error.Message,
                    "Streamroom", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
    }

    private void OpenInEdge(Uri target)
    {
        try
        {
            // Explicitly select Edge, even when Firefox is the default browser.
            Process.Start(new ProcessStartInfo("microsoft-edge:" + target.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception error) { MessageBox.Show(this, error.Message, "Could not open Edge"); }
    }
}
