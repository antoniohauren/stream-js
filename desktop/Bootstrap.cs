using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Windows.Forms;

internal static class Bootstrap
{
    internal static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Streamroom");

    [STAThread]
    private static int Main(string[] args)
    {
        bool test = args.Length == 1 && args[0] == "--self-test";
        try
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveAssembly;
            string loaderDirectory = ExtractLoader();
            // Keep WebView2 types out of this method: resolve dependencies before JIT loads them.
            return Start(loaderDirectory, test);
        }
        catch (Exception error)
        {
            if (test) Console.Error.WriteLine(error);
            else MessageBox.Show(error.Message, "Streamroom could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Start(string loaderDirectory, bool test)
    {
        return Program.Run(loaderDirectory, test);
    }

    private static Assembly ResolveAssembly(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
        return Assembly.Load(ReadResource(name + ".dll.gz"));
    }

    internal static byte[] ReadResource(string name)
    {
        using (Stream source = typeof(Bootstrap).Assembly.GetManifestResourceStream(name))
        {
            if (source == null) throw new IOException("Missing embedded resource: " + name);
            using (var gzip = new GZipStream(source, CompressionMode.Decompress))
            using (var result = new MemoryStream())
            {
                gzip.CopyTo(result);
                return result.ToArray();
            }
        }
    }

    private static string Hash(byte[] bytes)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static string ExtractLoader()
    {
        byte[] bytes = ReadResource("WebView2Loader.dll.gz");
        string hash = Hash(bytes);
        string directory = Path.Combine(DataDirectory, "Loader", hash);
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "WebView2Loader.dll");
        if (!File.Exists(path))
        {
            // Atomic publish: simultaneous launches never see a partially written DLL.
            string temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                File.WriteAllBytes(temporary, bytes);
                try { File.Move(temporary, path); }
                catch (IOException) { if (!File.Exists(path)) throw; }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        if (Hash(File.ReadAllBytes(path)) != hash)
            throw new IOException("WebView2 support file is damaged. Delete this folder and restart:\n" + directory);
        return directory;
    }
}
