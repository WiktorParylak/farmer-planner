// Farmer Planner's own installer and uninstaller window.
//
// The setup exe carries electron-builder's NSIS installer as an embedded
// resource ("payload.exe") and runs it silently, so NSIS still does the files,
// the Start menu entry, the "Apps" entry and in-place updates; this program is
// only the window around it. Built twice by tools/build-installer.js with the
// system's .NET Framework compiler (csc, C# 5): once with UNINSTALLER defined
// (no payload) and once as the setup, which embeds that uninstaller and copies
// it into the app folder as "Farmer Planner Uninstall.exe".
//
// Command line (setup):     --dir=<folder> --lang=en|pl|de   preset the folder / window language
//                           --elevated --dir=<folder> --shortcut=0|1 --run=0|1 --lang=en|pl|de
//                           (a copy of itself restarted with admin rights for a protected folder)
// Command line (uninstall): /S ...        forwarded to NSIS's own uninstaller (used by NSIS on update)
//                           --dir=<folder> the window, run from a copy in %TEMP%
//                           --elevated --delete-data=0|1   the same, restarted with admin rights

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using IPersistFile = System.Runtime.InteropServices.ComTypes.IPersistFile;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

[assembly: AssemblyTitle("Farmer Planner Setup")]
[assembly: AssemblyProduct("Farmer Planner")]
[assembly: AssemblyCompany("Wiktor Parylak")]
[assembly: AssemblyCopyright("Wiktor Parylak")]

namespace FarmerPlannerSetup
{
    static class Res
    {
        static Assembly Asm { get { return Assembly.GetExecutingAssembly(); } }

        public static bool Has(string name) { return Asm.GetManifestResourceNames().Contains(name); }

        public static string Text(string name)
        {
            using (Stream s = Asm.GetManifestResourceStream(name))
            {
                if (s == null) return null;
                using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }

        public static void Save(string name, string path)
        {
            using (Stream s = Asm.GetManifestResourceStream(name))
            using (FileStream f = File.Create(path)) s.CopyTo(f);
        }

        public static Stream Open(string name) { return Asm.GetManifestResourceStream(name); }

        public static string[] Names(string prefix)
        {
            return Asm.GetManifestResourceNames().Where(n => n.StartsWith(prefix)).ToArray();
        }
    }

    static class Texts
    {
        public static string Lang = "en";

        // key -> en, pl, de
        static readonly Dictionary<string, string[]> S = new Dictionary<string, string[]>
        {
            { "tagline", new[] { "Know what every field needs this month.", "Wiesz, czego każde pole potrzebuje w tym miesiącu.", "Du weißt, was jedes Feld diesen Monat braucht." } },
            { "version", new[] { "VERSION {0}", "WERSJA {0}", "VERSION {0}" } },
            { "welcomeTitle", new[] { "Install Farmer Planner", "Zainstaluj Farmer Planner", "Farmer Planner installieren" } },
            { "updateTitle", new[] { "Update Farmer Planner", "Aktualizacja Farmer Planner", "Farmer Planner aktualisieren" } },
            { "welcomeText", new[] {
                "The season planner for Farming Simulator 25. Your farms are kept in Documents\\Farmer Planner.",
                "Planer sezonów do Farming Simulator 25. Farmy są zapisywane w folderze Dokumenty\\Farmer Planner.",
                "Der Saisonplaner für den Landwirtschafts-Simulator 25. Deine Höfe liegen in Dokumente\\Farmer Planner." } },
            { "updateText", new[] {
                "Version {0} is installed — it will be updated to {1}. Your farms and settings stay as they are.",
                "Zainstalowana jest wersja {0} — zostanie zaktualizowana do {1}. Farmy i ustawienia zostają bez zmian.",
                "Version {0} ist installiert — sie wird auf {1} aktualisiert. Deine Höfe und Einstellungen bleiben erhalten." } },
            { "reinstallTitle", new[] { "Reinstall Farmer Planner", "Ponowna instalacja", "Farmer Planner neu installieren" } },
            { "reinstallText", new[] {
                "Version {0} is already installed — its files will be installed again. Your farms and settings stay as they are.",
                "Wersja {0} jest już zainstalowana — jej pliki zostaną zainstalowane ponownie. Farmy i ustawienia zostają bez zmian.",
                "Version {0} ist bereits installiert — ihre Dateien werden neu installiert. Deine Höfe und Einstellungen bleiben erhalten." } },
            { "reinstall", new[] { "Reinstall", "Zainstaluj ponownie", "Neu installieren" } },
            { "folder", new[] { "INSTALL FOLDER", "FOLDER INSTALACJI", "INSTALLATIONSORDNER" } },
            { "browse", new[] { "Browse…", "Przeglądaj…", "Durchsuchen…" } },
            { "folderTarget", new[] {
                "Farmer Planner goes into a folder of its own: {0}",
                "Farmer Planner trafi do własnego folderu: {0}",
                "Farmer Planner kommt in einen eigenen Ordner: {0}" } },
            { "folderUpdate", new[] {
                "An update goes into the folder of the installed version.",
                "Aktualizacja trafia do folderu zainstalowanej wersji.",
                "Ein Update kommt in den Ordner der installierten Version." } },
            { "errDirEmpty", new[] { "Type a folder, e.g. D:\\Games.", "Wpisz folder, np. D:\\Gry.", "Gib einen Ordner ein, z. B. D:\\Spiele." } },
            { "errDirRelative", new[] {
                "Type the full path with the drive, e.g. D:\\Games.",
                "Wpisz pełną ścieżkę z dyskiem, np. D:\\Gry.",
                "Gib den vollständigen Pfad mit Laufwerk ein, z. B. D:\\Spiele." } },
            { "errDirChars", new[] {
                "A folder name can't contain * ? \" < > | or a colon.",
                "Nazwa folderu nie może zawierać * ? \" < > | ani dwukropka.",
                "Ein Ordnername darf * ? \" < > | und keinen Doppelpunkt enthalten." } },
            { "errDirDrive", new[] { "There is no drive {0} on this computer.", "Na tym komputerze nie ma dysku {0}", "Auf diesem Computer gibt es kein Laufwerk {0}" } },
            { "pickFolder", new[] { "Where should Farmer Planner be installed?", "Gdzie zainstalować Farmer Planner?", "Wohin soll Farmer Planner installiert werden?" } },
            { "shortcut", new[] { "Desktop shortcut", "Skrót na pulpicie", "Verknüpfung auf dem Desktop" } },
            { "runAfter", new[] { "Start Farmer Planner when it's done", "Uruchom Farmer Planner po instalacji", "Farmer Planner danach starten" } },
            { "install", new[] { "Install", "Zainstaluj", "Installieren" } },
            { "update", new[] { "Update", "Aktualizuj", "Aktualisieren" } },
            { "installing", new[] { "Installing…", "Instaluję…", "Wird installiert…" } },
            { "updating", new[] { "Updating…", "Aktualizuję…", "Wird aktualisiert…" } },
            { "installingText", new[] {
                "Copying the app's files to {0}.",
                "Kopiuję pliki aplikacji do {0}.",
                "Die Dateien der App werden nach {0} kopiert." } },
            { "doneTitle", new[] { "Ready!", "Gotowe!", "Fertig!" } },
            { "doneText", new[] {
                "Farmer Planner {0} is installed. You'll find it in the Start menu.",
                "Farmer Planner {0} jest zainstalowany. Znajdziesz go w menu Start.",
                "Farmer Planner {0} ist installiert. Du findest ihn im Startmenü." } },
            { "close", new[] { "Close", "Zamknij", "Schließen" } },
            { "launch", new[] { "Start Farmer Planner", "Uruchom Farmer Planner", "Farmer Planner starten" } },
            { "errorTitle", new[] { "Something went wrong", "Coś poszło nie tak", "Etwas ist schiefgelaufen" } },
            { "errorText", new[] {
                "{0}\n\nTry again. If it keeps failing, save the log and send it through farmerplanner.pl/contact.",
                "{0}\n\nSpróbuj ponownie. Jeśli błąd się powtarza, zapisz log i wyślij go przez farmerplanner.pl/pl/kontakt.",
                "{0}\n\nVersuch es noch einmal. Wenn der Fehler bleibt, speichere das Log und schick es über farmerplanner.pl/de/kontakt." } },
            { "errExit", new[] { "The installer stopped with code {0}.", "Instalator zakończył się kodem {0}.", "Der Installer wurde mit Code {0} beendet." } },
            { "errNoExe", new[] { "The app's files weren't found in {0} after the installation.", "Po instalacji nie ma plików aplikacji w {0}.", "Nach der Installation fehlen die Dateien der App in {0}." } },
            { "errElevation", new[] {
                "Windows didn't allow writing to {0}. Allow the administrator prompt, or choose a folder of your own (e.g. in your user folder).",
                "Windows nie pozwolił zapisać w {0}. Zezwól w oknie administratora albo wybierz własny folder (np. w folderze użytkownika).",
                "Windows hat das Schreiben in {0} nicht erlaubt. Bestätige die Administrator-Abfrage oder wähle einen eigenen Ordner (z. B. im Benutzerordner)." } },
            { "saveLog", new[] { "Save log", "Zapisz log", "Log speichern" } },
            { "retry", new[] { "Try again", "Spróbuj ponownie", "Erneut versuchen" } },
            { "runningTitle", new[] { "Farmer Planner is open", "Farmer Planner jest otwarty", "Farmer Planner ist geöffnet" } },
            { "runningText", new[] {
                "Close the app so its files can be replaced. Your farms are kept.",
                "Zamknij aplikację, żeby można było podmienić jej pliki. Farmy zostają.",
                "Schließe die App, damit ihre Dateien ersetzt werden können. Deine Höfe bleiben erhalten." } },
            { "runningClose", new[] { "Close the app", "Zamknij aplikację", "App schließen" } },
            { "cancel", new[] { "Cancel", "Anuluj", "Abbrechen" } },

            { "uninstallTitle", new[] { "Uninstall Farmer Planner?", "Odinstalować Farmer Planner?", "Farmer Planner deinstallieren?" } },
            { "uninstallText", new[] {
                "The app will be removed from {0}. Your farms stay in Documents\\Farmer Planner, ready for a later install.",
                "Aplikacja zostanie usunięta z {0}. Farmy zostają w folderze Dokumenty\\Farmer Planner na wypadek ponownej instalacji.",
                "Die App wird aus {0} entfernt. Deine Höfe bleiben in Dokumente\\Farmer Planner für eine spätere Installation." } },
            { "deleteData", new[] { "Also delete my farms and settings", "Usuń też moje farmy i ustawienia", "Auch meine Höfe und Einstellungen löschen" } },
            { "deleteDataHint", new[] {
                "Documents\\Farmer Planner — this can't be undone.",
                "Folder Dokumenty\\Farmer Planner — tego nie da się cofnąć.",
                "Dokumente\\Farmer Planner — das lässt sich nicht rückgängig machen." } },
            { "uninstall", new[] { "Uninstall", "Odinstaluj", "Deinstallieren" } },
            { "uninstalling", new[] { "Uninstalling…", "Odinstalowuję…", "Wird deinstalliert…" } },
            { "uninstallingText", new[] { "Removing the app's files.", "Usuwam pliki aplikacji.", "Die Dateien der App werden entfernt." } },
            { "uninstalledTitle", new[] { "Uninstalled", "Odinstalowano", "Deinstalliert" } },
            { "uninstalledText", new[] {
                "Farmer Planner has been removed. Your farms are still in Documents\\Farmer Planner.",
                "Farmer Planner został usunięty. Farmy nadal są w folderze Dokumenty\\Farmer Planner.",
                "Farmer Planner wurde entfernt. Deine Höfe sind weiterhin in Dokumente\\Farmer Planner." } },
            { "uninstalledAllText", new[] {
                "Farmer Planner, your farms and its settings have been removed.",
                "Farmer Planner, Twoje farmy i ustawienia zostały usunięte.",
                "Farmer Planner, deine Höfe und die Einstellungen wurden entfernt." } },
            { "errUninstall", new[] { "The uninstaller stopped with code {0}.", "Deinstalator zakończył się kodem {0}.", "Die Deinstallation wurde mit Code {0} beendet." } },
        };

        public static string T(string key)
        {
            string[] v;
            if (!S.TryGetValue(key, out v)) return key;
            int i = Lang == "pl" ? 1 : Lang == "de" ? 2 : 0;
            return v[i];
        }

        public static string T(string key, params object[] args) { return string.Format(T(key), args); }

        // The app's own language (settings.json next to the farms), else Windows'.
        public static string Detect()
        {
            try
            {
                string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Farmer Planner", "settings.json");
                if (File.Exists(settings))
                {
                    Match m = Regex.Match(File.ReadAllText(settings), "\"farmer_planner_language\"\\s*:\\s*\"(\\w+)\"");
                    if (m.Success && (m.Groups[1].Value == "en" || m.Groups[1].Value == "pl" || m.Groups[1].Value == "de")) return m.Groups[1].Value;
                }
            }
            catch { }
            string ui = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            return ui == "pl" || ui == "de" ? ui : "en";
        }
    }

    // What NSIS left in the registry for the current user.
    class Installed
    {
        public const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        public string KeyName;
        public string Dir;
        public string Version;

        public static Installed Find()
        {
            using (RegistryKey root = Registry.CurrentUser.OpenSubKey(UninstallRoot))
            {
                if (root == null) return null;
                foreach (string name in root.GetSubKeyNames())
                {
                    using (RegistryKey k = root.OpenSubKey(name))
                    {
                        string display = k == null ? null : k.GetValue("DisplayName") as string;
                        if (display == null || !display.StartsWith("Farmer Planner")) continue;
                        Installed found = new Installed { KeyName = name };
                        found.Version = (k.GetValue("DisplayVersion") as string) ?? display.Substring("Farmer Planner".Length).Trim();
                        using (RegistryKey app = Registry.CurrentUser.OpenSubKey(@"Software\" + name))
                            found.Dir = app == null ? null : app.GetValue("InstallLocation") as string;
                        if (string.IsNullOrEmpty(found.Dir))
                        {
                            string icon = k.GetValue("DisplayIcon") as string;
                            if (icon != null) found.Dir = Path.GetDirectoryName(icon.Split(',')[0].Trim('"'));
                        }
                        return found;
                    }
                }
            }
            return null;
        }

        public void SetUninstallString(string value)
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallRoot + "\\" + KeyName, true))
                if (k != null) k.SetValue("UninstallString", value);
        }

        public string UninstallString()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallRoot + "\\" + KeyName))
                return k == null ? null : k.GetValue("UninstallString") as string;
        }
    }

    static class Sys
    {
        public const string AppExe = "Farmer Planner.exe";
        public const string NsisUninstaller = "Uninstall Farmer Planner.exe";
        public const string OurUninstaller = "Farmer Planner Uninstall.exe";

        public static string Self { get { return Assembly.GetExecutingAssembly().Location; } }

        public static bool IsElevated
        {
            get { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
        }

        public static string DefaultDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Farmer Planner"); }
        }

        public static string DesktopShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Farmer Planner.lnk"); }
        }

        // The app always gets a folder of its own, so an uninstall never empties
        // the folder the user picked (e.g. "D:\Games").
        public static string Normalize(string dir)
        {
            dir = dir.TrimEnd('\\', '/');
            if (dir.Length == 2 && dir[1] == ':') dir += "\\";
            return string.Equals(Path.GetFileName(dir), "Farmer Planner", StringComparison.OrdinalIgnoreCase)
                ? dir : Path.Combine(dir, "Farmer Planner");
        }

        // A typed install folder: null and the normalized folder when it can be
        // used, otherwise the message for the user.
        public static string CheckDir(string text, out string dir)
        {
            dir = null;
            string s = (text ?? "").Trim().Trim('"').Replace('/', '\\');
            if (s.Length == 0) return Texts.T("errDirEmpty");
            if (s.Length == 2 && s[1] == ':') s += "\\";
            bool drive = Regex.IsMatch(s, @"^[A-Za-z]:\\");
            if (!drive && !s.StartsWith(@"\\")) return Texts.T("errDirRelative");
            if (s.IndexOfAny("*?\"<>|".ToCharArray()) >= 0 || s.IndexOfAny(Path.GetInvalidPathChars()) >= 0
                || s.IndexOf(':', 2) >= 0) return Texts.T("errDirChars");
            try { s = Path.GetFullPath(s); }
            catch { return Texts.T("errDirChars"); }
            if (drive && !Directory.Exists(s.Substring(0, 3))) return Texts.T("errDirDrive", s.Substring(0, 2).ToUpperInvariant());
            dir = Normalize(s);
            return null;
        }

        public static bool CanWrite(string dir)
        {
            string probe = dir;
            while (!Directory.Exists(probe))
            {
                probe = Path.GetDirectoryName(probe);
                if (probe == null) return false;
            }
            try
            {
                string f = Path.Combine(probe, ".fp-write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(f, "");
                File.Delete(f);
                return true;
            }
            catch { return false; }
        }

        public static long DirSize(string dir)
        {
            long size = 0;
            try
            {
                if (!Directory.Exists(dir)) return 0;
                foreach (string f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { size += new FileInfo(f).Length; } catch { }
                }
            }
            catch { }
            return size;
        }

        public static Process[] RunningApp()
        {
            return Process.GetProcessesByName(Path.GetFileNameWithoutExtension(AppExe));
        }

        public static void CloseApp()
        {
            foreach (Process p in RunningApp())
            {
                try { if (p.MainWindowHandle != IntPtr.Zero) p.CloseMainWindow(); } catch { }
            }
            DateTime until = DateTime.Now.AddSeconds(8);
            while (RunningApp().Length > 0 && DateTime.Now < until) Thread.Sleep(250);
            foreach (Process p in RunningApp())
            {
                try { p.Kill(); } catch { }
            }
            Thread.Sleep(500);
        }

        // IShellLinkW, not WScript.Shell: that one saves the target in the ANSI
        // code page, so "D:\Gry Ąę" became "D:\Gry Ae" and the shortcut led nowhere.
        public static void CreateShortcut(string lnk, string target)
        {
            IShellLinkW link = (IShellLinkW)new ShellLink();
            try
            {
                link.SetPath(target);
                link.SetWorkingDirectory(Path.GetDirectoryName(target));
                link.SetIconLocation(target, 0);
                link.SetDescription("Farmer Planner");
                ((IPersistFile)link).Save(lnk, true);
            }
            finally { Marshal.ReleaseComObject(link); }
        }

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        class ShellLink { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr findData, int flags);
            void GetIDList(out IntPtr idl);
            void SetIDList(IntPtr idl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short hotkey);
            void SetHotkey(short hotkey);
            void GetShowCmd(out int showCmd);
            void SetShowCmd(int showCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int icon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int icon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
            void Resolve(IntPtr hwnd, int flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }

        // Started from an elevated process, the app would run as administrator
        // too; explorer starts it as the signed-in user.
        public static void Launch(string exe)
        {
            if (IsElevated) Process.Start("explorer.exe", "\"" + exe + "\"");
            else Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = Path.GetDirectoryName(exe), UseShellExecute = true });
        }

        public static string Quote(string arg) { return "\"" + arg.Replace("\"", "") + "\""; }

        public static string Arg(string[] args, string name)
        {
            foreach (string a in args)
                if (a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) return a.Substring(name.Length + 1);
            return null;
        }

        public static bool Flag(string[] args, string name)
        {
            return args.Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
        }

        // Restart this exe with admin rights; false if the prompt was declined.
        public static bool RunElevated(string exe, string args)
        {
            try
            {
                Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = true, Verb = "runas" });
                return true;
            }
            catch (Win32Exception) { return false; }
        }

        public static void DeleteLater(string path)
        {
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & del /f /q " + Quote(path))
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            catch { }
        }
    }

    // Windows' modern folder picker (IFileOpenDialog with FOS_PICKFOLDERS).
    static class FolderPicker
    {
        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        class FileOpenDialog { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
            void SetFileTypeIndex(uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise(IntPtr pfde, out uint pdwCookie);
            void Unadvise(uint dwCookie);
            void SetOptions(uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder(IShellItem psi);
            void SetFolder(IShellItem psi);
            void GetFolder(out IShellItem ppsi);
            void GetCurrentSelection(out IShellItem ppsi);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult(out IShellItem ppsi);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem ppsi);
            void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

        const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
        const uint SIGDN_FILESYSPATH = 0x80058000;

        public static string Pick(Window owner, string title, string start)
        {
            IFileOpenDialog dlg = (IFileOpenDialog)new FileOpenDialog();
            dlg.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
            dlg.SetTitle(title);
            try
            {
                string existing = start;
                while (existing != null && !Directory.Exists(existing)) existing = Path.GetDirectoryName(existing);
                if (existing != null)
                {
                    IShellItem folder;
                    SHCreateItemFromParsingName(existing, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
                    dlg.SetFolder(folder);
                }
            }
            catch { }
            if (dlg.Show(new WindowInteropHelper(owner).Handle) != 0) return null;
            IShellItem result;
            dlg.GetResult(out result);
            string path;
            result.GetDisplayName(SIGDN_FILESYSPATH, out path);
            return path;
        }
    }

    class SetupWindow
    {
        readonly string[] args;
        readonly string version;
        readonly long appSize;
        readonly StringBuilder log = new StringBuilder();
        Window win;
        bool busy;

#if UNINSTALLER
        string uninstallDir;
        bool deleteData;
        bool removedData;
#else
        Installed existing;
        string installDir;
#endif

        static readonly string[] Panels = { "PanelWelcome", "PanelUninstall", "PanelRunning", "PanelProgress", "PanelDone", "PanelError" };

        public SetupWindow(string[] args)
        {
            this.args = args;
            Dictionary<string, string> meta = new Dictionary<string, string>();
            foreach (string line in (Res.Text("meta.txt") ?? "").Split('\n'))
            {
                int eq = line.IndexOf('=');
                if (eq > 0) meta[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            version = meta.ContainsKey("version") ? meta["version"] : "";
            long size;
            appSize = meta.ContainsKey("appSize") && long.TryParse(meta["appSize"], out size) && size > 0 ? size : 360L * 1024 * 1024;

            string lang = Sys.Arg(args, "--lang");
            Texts.Lang = lang == "en" || lang == "pl" || lang == "de" ? lang : Texts.Detect();
            Log("Farmer Planner setup " + version + ", lang " + Texts.Lang + ", elevated " + Sys.IsElevated + ", args: " + string.Join(" ", args));
        }

        T El<T>(string name) where T : class { return win.FindName(name) as T; }
        static readonly string[] Upper = { "WelcomeTitle", "UninstallTitle", "RunningTitle", "ProgressTitle", "DoneTitle", "ErrorTitle",
            "InstallBtn", "UninstallBtn", "RunningCloseBtn", "LaunchBtn", "RetryBtn" };

        // Headings and filled buttons are in capitals, like in the app.
        static string Case(string name, string value)
        {
            return Upper.Contains(name) ? value.ToUpper(System.Globalization.CultureInfo.CurrentCulture) : value;
        }

        void Text(string name, string value) { El<TextBlock>(name).Text = Case(name, value); }
        void Content(string name, string value) { El<ContentControl>(name).Content = Case(name, value); }
        void Click(string name, RoutedEventHandler h) { El<Button>(name).Click += h; }

        void Log(string line) { lock (log) log.AppendLine(DateTime.Now.ToString("HH:mm:ss.fff") + "  " + line); }

        void Show(string panel)
        {
            foreach (string p in Panels) El<FrameworkElement>(p).Visibility = p == panel ? Visibility.Visible : Visibility.Collapsed;
            El<Button>("CloseBtn").IsEnabled = panel != "PanelProgress";
        }

        void Ui(Action a) { win.Dispatcher.Invoke(a); }

        public Window Build()
        {
            win = (Window)XamlReader.Parse(Res.Text("Window.xaml"));
            LoadFonts();
            try
            {
                using (Stream s = Res.Open("icon.ico")) if (s != null) win.Icon = BitmapFrame.Create(s, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
            }
            catch { }

            win.MouseLeftButtonDown += (s, e) => { try { win.DragMove(); } catch { } };
            Click("CloseBtn", (s, e) => win.Close());
            win.Closing += (s, e) => { if (busy) e.Cancel = true; };

            Text("Tagline", Texts.T("tagline"));
            Text("VersionLabel", Texts.T("version", version));
            Content("CloseBtn", "");
            Content("DoneCloseBtn", Texts.T("close"));
            Content("SaveLogBtn", Texts.T("saveLog"));
            Content("RetryBtn", Texts.T("retry"));
            Content("RunningCancelBtn", Texts.T("cancel"));
            Content("RunningCloseBtn", Texts.T("runningClose"));
            Text("RunningTitle", Texts.T("runningTitle"));
            Text("RunningText", Texts.T("runningText"));
            Text("ErrorTitle", Texts.T("errorTitle"));
            Click("SaveLogBtn", (s, e) => SaveLog());
            Click("DoneCloseBtn", (s, e) => win.Close());

#if UNINSTALLER
            BuildUninstall();
#else
            BuildInstall();
#endif
            return win;
        }

        // Fonts embedded as "font-*.ttf": written next to each other in %TEMP%
        // and used by family name; without them the XAML's system fonts stay.
        void LoadFonts()
        {
            try
            {
                string[] fonts = Res.Names("font-");
                if (fonts.Length == 0) return;
                string dir = Path.Combine(Path.GetTempPath(), "FarmerPlannerSetupFonts-" + version);
                Directory.CreateDirectory(dir);
                foreach (string f in fonts)
                {
                    string path = Path.Combine(dir, f);
                    if (!File.Exists(path)) Res.Save(f, path);
                }
                Uri baseUri = new Uri(dir + "\\");
                win.Resources["Display"] = new FontFamily(baseUri, "./#Big Shoulders Display, Bahnschrift");
                win.Resources["Body"] = new FontFamily(baseUri, "./#IBM Plex Sans, Segoe UI");
                win.Resources["Mono"] = new FontFamily(baseUri, "./#IBM Plex Mono SemiBold, IBM Plex Mono, Consolas");
            }
            catch (Exception ex) { Log("fonts: " + ex.Message); }
        }

        void SaveLog()
        {
            SaveFileDialog dlg = new SaveFileDialog
            {
                FileName = "farmer-planner-setup-log.txt",
                Filter = "Text|*.txt",
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
            };
            if (dlg.ShowDialog(win) == true)
            {
                lock (log) File.WriteAllText(dlg.FileName, log.ToString(), Encoding.UTF8);
            }
        }

        void Fail(string message)
        {
            Log("ERROR " + message);
            Ui(() =>
            {
                busy = false;
                Text("ErrorText", Texts.T("errorText", message));
                Show("PanelError");
            });
        }

        void Progress(double percent)
        {
            Ui(() =>
            {
                ProgressBar bar = El<ProgressBar>("Progress");
                if (percent > bar.Value) bar.Value = percent;
                Text("ProgressPercent", ((int)bar.Value) + " %");
            });
        }

        // Asks to close the app if it's open, then runs next.
        void WhenAppClosed(Action next, Action cancelled)
        {
            if (Sys.RunningApp().Length == 0) { next(); return; }
            Show("PanelRunning");
            RoutedEventHandler onClose = null, onCancel = null;
            Action unhook = () =>
            {
                El<Button>("RunningCloseBtn").Click -= onClose;
                El<Button>("RunningCancelBtn").Click -= onCancel;
            };
            onClose = (s, e) =>
            {
                unhook();
                El<Button>("RunningCloseBtn").IsEnabled = false;
                new Thread(() =>
                {
                    Sys.CloseApp();
                    Ui(() => { El<Button>("RunningCloseBtn").IsEnabled = true; next(); });
                }) { IsBackground = true }.Start();
            };
            onCancel = (s, e) => { unhook(); cancelled(); };
            El<Button>("RunningCloseBtn").Click += onClose;
            El<Button>("RunningCancelBtn").Click += onCancel;
        }

#if !UNINSTALLER
        // ---------------- install ----------------

        void BuildInstall()
        {
            existing = Installed.Find();
            if (existing != null && (existing.Dir == null || !File.Exists(Path.Combine(existing.Dir, Sys.AppExe)))) existing = null;
            installDir = existing != null ? existing.Dir : Sys.DefaultDir;
            // --dir=<folder> picks the folder up front, as "Change folder" would.
            if (existing == null && !Sys.Flag(args, "--elevated") && Sys.Arg(args, "--dir") != null) installDir = Sys.Normalize(Sys.Arg(args, "--dir"));
            Log("existing: " + (existing == null ? "none" : existing.Version + " in " + existing.Dir));

            bool update = existing != null;
            bool same = update && existing.Version == version;
            Text("WelcomeTitle", Texts.T(!update ? "welcomeTitle" : same ? "reinstallTitle" : "updateTitle"));
            Text("WelcomeText", !update ? Texts.T("welcomeText") : same ? Texts.T("reinstallText", version) : Texts.T("updateText", existing.Version, version));
            Text("FolderLabel", Texts.T("folder"));
            Text("ChangeFolderText", Texts.T("browse"));
            TextBox folderBox = El<TextBox>("FolderPath");
            folderBox.Text = installDir;
            folderBox.IsReadOnly = update;
            El<Button>("ChangeFolderBtn").Visibility = update ? Visibility.Collapsed : Visibility.Visible;
            if (update) Text("FolderHint", Texts.T("folderUpdate"));
            else
            {
                folderBox.TextChanged += (s, e) => CheckFolder();
                CheckFolder();
            }
            Content("ShortcutBox", Texts.T("shortcut"));
            Content("RunBox", Texts.T("runAfter"));
            El<CheckBox>("ShortcutBox").IsChecked = !update || File.Exists(Sys.DesktopShortcut);
            Content("InstallBtn", Texts.T(!update ? "install" : same ? "reinstall" : "update"));
            Content("LaunchBtn", Texts.T("launch"));
            Text("ProgressTitle", Texts.T(update && !same ? "updating" : "installing"));

            Click("ChangeFolderBtn", (s, e) =>
            {
                string start = CheckFolder() ? installDir : Sys.DefaultDir;
                string picked = FolderPicker.Pick(win, Texts.T("pickFolder"), Directory.Exists(start) ? start : Path.GetDirectoryName(start));
                if (picked == null) return;
                folderBox.Text = Sys.Normalize(picked);
                folderBox.CaretIndex = folderBox.Text.Length;
            });
            Click("InstallBtn", (s, e) =>
            {
                if (update || CheckFolder()) { StartInstall(); return; }
                folderBox.Focus();
                folderBox.SelectAll();
            });
            Click("RetryBtn", (s, e) => Show("PanelWelcome"));
            Click("LaunchBtn", (s, e) =>
            {
                try { Sys.Launch(Path.Combine(installDir, Sys.AppExe)); } catch (Exception ex) { Log("launch: " + ex.Message); }
                win.Close();
            });

            Show("PanelWelcome");

            // Restarted with admin rights for a protected folder: straight to work.
            if (Sys.Flag(args, "--elevated") && Sys.Arg(args, "--dir") != null)
            {
                installDir = Sys.Arg(args, "--dir");
                El<CheckBox>("ShortcutBox").IsChecked = Sys.Arg(args, "--shortcut") != "0";
                El<CheckBox>("RunBox").IsChecked = Sys.Arg(args, "--run") != "0";
                win.Loaded += (s, e) => StartInstall();
            }
        }

        // Reads the typed folder into installDir; under the box shows where the
        // app will really go (its own "Farmer Planner" subfolder) or what's wrong.
        bool CheckFolder()
        {
            TextBox box = El<TextBox>("FolderPath");
            string dir;
            string error = Sys.CheckDir(box.Text, out dir);
            TextBlock hint = El<TextBlock>("FolderHint");
            box.Tag = error != null ? "error" : null;
            hint.Foreground = (Brush)win.FindResource(error != null ? "Rust" : "InkFaint");
            box.ToolTip = string.IsNullOrWhiteSpace(box.Text) ? null : box.Text;
            if (error != null) { hint.Text = error; return false; }
            installDir = dir;
            string typed = box.Text.Trim().Trim('"').TrimEnd('\\', '/');
            hint.Text = string.Equals(typed, dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ? "" : Texts.T("folderTarget", dir);
            return true;
        }

        void StartInstall()
        {
            if (!Sys.IsElevated && !Sys.CanWrite(installDir))
            {
                Log("no write access to " + installDir + ", restarting elevated");
                string a = "--elevated " + Sys.Quote("--dir=" + installDir)
                    + " --shortcut=" + (El<CheckBox>("ShortcutBox").IsChecked == true ? "1" : "0")
                    + " --run=" + (El<CheckBox>("RunBox").IsChecked == true ? "1" : "0")
                    + " --lang=" + Texts.Lang;
                if (Sys.RunElevated(Sys.Self, a)) { win.Close(); return; }
                Fail(Texts.T("errElevation", installDir));
                return;
            }
            WhenAppClosed(RunInstall, () => Show("PanelWelcome"));
        }

        void RunInstall()
        {
            busy = true;
            bool shortcut = El<CheckBox>("ShortcutBox").IsChecked == true;
            bool run = El<CheckBox>("RunBox").IsChecked == true;
            bool update = existing != null;
            string dir = installDir;
            El<ProgressBar>("Progress").Value = 0;
            Text("ProgressPercent", "0 %");
            Text("ProgressText", Texts.T("installingText", dir));
            Show("PanelProgress");

            new Thread(() =>
            {
                string tmp = Path.Combine(Path.GetTempPath(), "FarmerPlannerSetup-" + Guid.NewGuid().ToString("N"));
                try
                {
                    Directory.CreateDirectory(tmp);
                    string payload = Path.Combine(tmp, "payload.exe");
                    Res.Save("payload.exe", payload);
                    Log("payload extracted to " + payload);

                    // NSIS runs the previous version's uninstaller on update; give it its own back.
                    Installed before = Installed.Find();
                    if (before != null && (before.UninstallString() ?? "").Contains(Sys.OurUninstaller) && before.Dir != null)
                        before.SetUninstallString(Sys.Quote(Path.Combine(before.Dir, Sys.NsisUninstaller)) + " /currentuser");

                    // /D must come last and unquoted.
                    ProcessStartInfo psi = new ProcessStartInfo(payload, "/S /currentuser /D=" + dir) { UseShellExecute = false };
                    Log("run: payload.exe " + psi.Arguments);
                    Process p = Process.Start(psi);
                    DateTime start = DateTime.Now;
                    while (!p.WaitForExit(250))
                    {
                        // Files written so far; an update first removes the old ones, so
                        // there the estimate goes by time.
                        double bySize = 100.0 * Sys.DirSize(dir) / appSize;
                        double byTime = 95 * (1 - Math.Exp(-(DateTime.Now - start).TotalSeconds / 9));
                        Progress(Math.Min(95, update ? byTime : Math.Max(bySize * 0.95, byTime * 0.5)));
                    }
                    Log("payload exit " + p.ExitCode);
                    if (p.ExitCode != 0) throw new Exception(Texts.T("errExit", p.ExitCode));
                    string exe = Path.Combine(dir, Sys.AppExe);
                    if (!File.Exists(exe)) throw new Exception(Texts.T("errNoExe", dir));
                    Progress(97);

                    // Our uninstaller window instead of NSIS's.
                    string ours = Path.Combine(dir, Sys.OurUninstaller);
                    Res.Save("uninstall.exe", ours);
                    Installed now = Installed.Find();
                    if (now != null) now.SetUninstallString(Sys.Quote(ours));
                    Log("uninstaller: " + ours + ", key " + (now == null ? "?" : now.KeyName));

                    try
                    {
                        if (shortcut) Sys.CreateShortcut(Sys.DesktopShortcut, exe);
                        else if (File.Exists(Sys.DesktopShortcut)) File.Delete(Sys.DesktopShortcut);
                    }
                    catch (Exception ex) { Log("shortcut: " + ex.Message); }

                    Progress(100);
                    Log("done");
                    Ui(() =>
                    {
                        busy = false;
                        Text("DoneTitle", Texts.T("doneTitle"));
                        Text("DoneText", Texts.T("doneText", version));
                        Show("PanelDone");
                        if (run)
                        {
                            try { Sys.Launch(exe); } catch (Exception ex) { Log("launch: " + ex.Message); }
                            System.Windows.Threading.DispatcherTimer timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
                            timer.Tick += (s, e) => { timer.Stop(); win.Close(); };
                            timer.Start();
                        }
                    });
                }
                catch (Exception ex)
                {
                    Fail(ex.Message);
                }
                finally
                {
                    try { Directory.Delete(tmp, true); } catch { }
                }
            }) { IsBackground = true }.Start();
        }
#endif

#if UNINSTALLER
        // ---------------- uninstall ----------------

        void BuildUninstall()
        {
            uninstallDir = Sys.Arg(args, "--dir");
            Text("UninstallTitle", Texts.T("uninstallTitle"));
            Text("UninstallText", Texts.T("uninstallText", uninstallDir));
            Content("DeleteDataBox", Texts.T("deleteData"));
            Text("DeleteDataHint", Texts.T("deleteDataHint"));
            Content("UninstallBtn", Texts.T("uninstall"));
            Content("UninstallCancelBtn", Texts.T("cancel"));
            Text("ProgressTitle", Texts.T("uninstalling"));
            Text("ProgressText", Texts.T("uninstallingText"));
            El<Button>("LaunchBtn").Visibility = Visibility.Collapsed;
            Click("UninstallCancelBtn", (s, e) => win.Close());
            Click("RetryBtn", (s, e) => Show("PanelUninstall"));
            Click("UninstallBtn", (s, e) => StartUninstall());
            // This copy runs from %TEMP%: remove it once the window is gone.
            win.Closed += (s, e) => Sys.DeleteLater(Sys.Self);
            Show("PanelUninstall");

            if (Sys.Flag(args, "--elevated"))
            {
                El<CheckBox>("DeleteDataBox").IsChecked = Sys.Arg(args, "--delete-data") == "1";
                win.Loaded += (s, e) => StartUninstall();
            }
        }

        void StartUninstall()
        {
            deleteData = El<CheckBox>("DeleteDataBox").IsChecked == true;
            if (!Sys.IsElevated && !Sys.CanWrite(uninstallDir))
            {
                string a = "--elevated " + Sys.Quote("--dir=" + uninstallDir) + " --delete-data=" + (deleteData ? "1" : "0") + " --lang=" + Texts.Lang;
                // The elevated copy deletes itself; this one too, via Closed.
                string copy = Path.Combine(Path.GetTempPath(), "FarmerPlannerUninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Sys.Self, copy);
                if (Sys.RunElevated(copy, a)) { win.Close(); return; }
                Fail(Texts.T("errElevation", uninstallDir));
                return;
            }
            WhenAppClosed(RunUninstall, () => Show("PanelUninstall"));
        }

        void RunUninstall()
        {
            busy = true;
            El<ProgressBar>("Progress").Value = 0;
            Show("PanelProgress");
            string dir = uninstallDir;
            bool withData = deleteData;

            new Thread(() =>
            {
                try
                {
                    Progress(10);
                    string nsis = Path.Combine(dir, Sys.NsisUninstaller);
                    if (File.Exists(nsis))
                    {
                        // _?= keeps NSIS in place (no copy to %TEMP%), so this waits for it.
                        ProcessStartInfo psi = new ProcessStartInfo(nsis, "/currentuser /S _?=" + dir) { UseShellExecute = false };
                        Log("run: " + nsis + " " + psi.Arguments);
                        Process p = Process.Start(psi);
                        DateTime start = DateTime.Now;
                        while (!p.WaitForExit(250))
                            Progress(10 + 75 * (1 - Math.Exp(-(DateTime.Now - start).TotalSeconds / 4)));
                        Log("nsis uninstall exit " + p.ExitCode);
                        if (p.ExitCode != 0) throw new Exception(Texts.T("errUninstall", p.ExitCode));
                    }
                    else
                    {
                        // No NSIS uninstaller (a broken install): drop the registry entry ourselves.
                        Installed found = Installed.Find();
                        if (found != null)
                        {
                            Registry.CurrentUser.DeleteSubKeyTree(Installed.UninstallRoot + "\\" + found.KeyName, false);
                            Registry.CurrentUser.DeleteSubKeyTree(@"Software\" + found.KeyName, false);
                        }
                    }
                    Progress(88);

                    // What's left: NSIS's uninstaller (kept by _?=) and ours.
                    foreach (string f in new[] { Sys.NsisUninstaller, Sys.OurUninstaller })
                    {
                        try { File.Delete(Path.Combine(dir, f)); } catch { }
                    }
                    try
                    {
                        if (string.Equals(Path.GetFileName(dir.TrimEnd('\\')), "Farmer Planner", StringComparison.OrdinalIgnoreCase))
                            Directory.Delete(dir, true);
                        else if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                            Directory.Delete(dir);
                    }
                    catch (Exception ex) { Log("folder: " + ex.Message); }
                    try { if (File.Exists(Sys.DesktopShortcut)) File.Delete(Sys.DesktopShortcut); } catch { }

                    if (withData)
                    {
                        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                        foreach (string d in new[] {
                            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Farmer Planner"),
                            Path.Combine(appData, "farmer-planner"),
                            Path.Combine(appData, "FarmerPlanner") })
                        {
                            try { if (Directory.Exists(d)) Directory.Delete(d, true); Log("deleted " + d); }
                            catch (Exception ex) { Log("data " + d + ": " + ex.Message); }
                        }
                        removedData = true;
                    }

                    Progress(100);
                    Ui(() =>
                    {
                        busy = false;
                        Text("DoneTitle", Texts.T("uninstalledTitle"));
                        Text("DoneText", Texts.T(removedData ? "uninstalledAllText" : "uninstalledText"));
                        Show("PanelDone");
                    });
                }
                catch (Exception ex)
                {
                    Fail(ex.Message);
                }
            }) { IsBackground = true }.Start();
        }

        // NSIS, updating to a new version, runs the registered uninstaller with /S:
        // pass that on to its own uninstaller, no window.
        public static int Forward(string[] args)
        {
            string dir = null;
            foreach (string a in args) if (a.StartsWith("_?=")) dir = a.Substring(3);
            if (dir == null) dir = Path.GetDirectoryName(Sys.Self);
            string nsis = Path.Combine(dir, Sys.NsisUninstaller);
            if (!File.Exists(nsis)) return 2;
            string rest = string.Join(" ", args.Where(a => !a.StartsWith("_?=")));
            Process p = Process.Start(new ProcessStartInfo(nsis, rest + " _?=" + dir) { UseShellExecute = false });
            p.WaitForExit();
            return p.ExitCode;
        }
#endif
    }

    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
#if UNINSTALLER
            if (args.Any(a => string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase))) return SetupWindow.Forward(args);
            if (Sys.Arg(args, "--dir") == null)
            {
                // Started from the app folder ("Apps" -> Uninstall): run a copy from
                // %TEMP%, so the whole folder can go.
                string dir = Path.GetDirectoryName(Sys.Self);
                string copy = Path.Combine(Path.GetTempPath(), "FarmerPlannerUninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Sys.Self, copy);
                string lang = Sys.Arg(args, "--lang");
                Process.Start(new ProcessStartInfo(copy, Sys.Quote("--dir=" + dir) + (lang != null ? " --lang=" + lang : "")) { UseShellExecute = false });
                return 0;
            }
#endif
            try
            {
                Application app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                SetupWindow setup = new SetupWindow(args);
                return app.Run(setup.Build());
            }
            catch (Exception ex)
            {
                // Without the window there's nothing else to show it in.
                string file = Path.Combine(Path.GetTempPath(), "farmer-planner-setup-error.txt");
                try { File.WriteAllText(file, ex.ToString()); } catch { }
                MessageBox.Show(ex.Message + "\n\n" + file, "Farmer Planner", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }
    }
}
