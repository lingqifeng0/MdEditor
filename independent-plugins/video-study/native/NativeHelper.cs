using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class NativeHelper
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    private delegate bool EnumWindow(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    private static Dictionary<string, object> Identity(uint pid)
    {
        var handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) throw new IOException("Cannot inspect the pipe owner process.");
        try
        {
            uint size = 32768;
            var name = new StringBuilder((int)size);
            if (!QueryFullProcessImageName(handle, 0, name, ref size)) throw new IOException("Cannot resolve the pipe owner executable.");
            using (var process = Process.GetProcessById((int)pid))
                return new Dictionary<string, object> {
                    {"pid", (int)pid}, {"executable", name.ToString()},
                    {"started", process.StartTime.ToUniversalTime().ToString("o")}
                };
        }
        finally { CloseHandle(handle); }
    }

    private static object Run(Dictionary<string, object> request)
    {
        string operation = Convert.ToString(request["operation"]);
        if (operation == "pipe")
        {
            string name = Convert.ToString(request["name"]);
            if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-zA-Z0-9._-]{1,150}$"))
                throw new ArgumentException("Invalid pipe name.");
            using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                pipe.Connect(100);
                uint pid;
                if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid)) throw new IOException("Cannot inspect the named pipe.");
                return Identity(pid);
            }
        }
        if (operation == "process") return Identity(Convert.ToUInt32(request["pid"]));
        if (operation == "executable")
        {
            var version = FileVersionInfo.GetVersionInfo(Convert.ToString(request["path"]));
            return new Dictionary<string, object> {
                {"product", version.ProductName ?? ""}, {"description", version.FileDescription ?? ""},
                {"original", version.OriginalFilename ?? ""}, {"version", version.FileVersion ?? ""}
            };
        }
        if (operation == "focus")
        {
            uint target = Convert.ToUInt32(request["pid"]);
            var identity = Identity(target);
            if (!String.Equals(Convert.ToString(identity["executable"]), Convert.ToString(request["executable"]), StringComparison.OrdinalIgnoreCase))
                throw new IOException("The target process changed.");
            if (!String.Equals(Convert.ToString(identity["started"]), Convert.ToString(request["started"]), StringComparison.Ordinal))
                throw new IOException("The target process identity changed.");
            bool found = false;
            EnumWindows(delegate(IntPtr window, IntPtr parameter) {
                uint pid;
                GetWindowThreadProcessId(window, out pid);
                if (pid != target || !IsWindowVisible(window)) return true;
                ShowWindow(window, 9);
                SetForegroundWindow(window);
                found = true;
                return false;
            }, IntPtr.Zero);
            return found;
        }
        throw new ArgumentException("Unknown helper operation.");
    }

    public static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer();
        json.MaxJsonLength = 65536;
        Console.WriteLine("{\"ready\":true}");
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            object id = 0;
            try
            {
                if (line.Length > 65536) throw new ArgumentException("Request too large.");
                var request = json.Deserialize<Dictionary<string, object>>(line);
                id = request["id"];
                Console.WriteLine(json.Serialize(new Dictionary<string, object> {{"id", id}, {"ok", true}, {"value", Run(request)}}));
            }
            catch (Exception error)
            {
                Console.WriteLine(json.Serialize(new Dictionary<string, object> {{"id", id}, {"ok", false}, {"message", error.Message}}));
            }
        }
        return 0;
    }
}
