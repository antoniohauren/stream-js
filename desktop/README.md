# Streamroom for Windows 11

A small, **single-file EXE** that always opens **https://share.detrouse.com/**.
It uses Microsoft's Chromium-based WebView2 runtime, not the default browser,
even if that browser is Firefox. There is no website prompt or URL override;
old `website.txt` settings are ignored.

## Use

Send `desktop/dist/Streamroom.exe` to your friend. Double-click it, join a room,
and click **Share screen**. No ZIP, companion DLLs, configuration, or installation
is needed. The EXE includes an original screen/play icon for Explorer and the
window/taskbar. It is unsigned; SmartScreen may warn. Only run trusted builds.

The app does not host a server. **Reload** disconnects an active room/share;
closing the window stops sharing. **Open in Edge** explicitly opens the same
site in full Microsoft Edge, never Firefox.

Screen/window capture and microphone use WebView2's normal permission prompts.
**Audio source availability depends on the installed runtime and Windows.**
WebView2 has no normal browser tabs to share. If the desired source/audio is
missing, use **Open in Edge**. The wrapper does not change WebRTC quality or fix
network/TURN issues. Live screen/audio capture needs Windows acceptance testing.

## How the single EXE stays small

- WebView2 support DLLs are compressed inside the EXE; managed DLLs load in memory.
- The native `WebView2Loader.dll` automatically unpacks under
  `%LOCALAPPDATA%\Streamroom\Loader\<sha256>`. Its contents are checked before use;
  simultaneous launches use atomic extraction. No manual unpacking is needed.
- Browser storage/cache lives in `%LOCALAPPDATA%\Streamroom\WebView2`.
- The browser engine and .NET are **not bundled**. Windows 11 normally includes
  Evergreen WebView2 Runtime and .NET Framework 4.8 or newer. If WebView2 is missing,
  install Microsoft's runtime from https://developer.microsoft.com/microsoft-edge/webview2/.
  That shared runtime is much larger than this launcher. No admin rights are needed
  by the launcher itself.

Top-level navigation stays on the configured origin. External HTTPS links open
in Edge; downloads are blocked. Microphone/capture access is not auto-granted.
**About** displays embedded WebView2 license and third-party notices.

## Build (Windows, no developer tools required)

From this repository, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

Output: **`desktop/dist/Streamroom.exe`**, approximately 330 KiB. Send this file
alone. It targets x64; Windows 11 ARM can use x64 emulation. The script prints
the exact file size. There are no server build/deployment changes.

The build uses Windows' existing .NET Framework compiler and downloads a pinned,
SHA-256-verified WebView2 SDK from NuGet into `desktop/.cache`. Support libraries
and license notices become compressed resources. `make-icon.ps1` generates the
original multi-resolution icon (16–256 px) without external assets or packages.

The script runs 18 URL/origin checks and tests a copy of the EXE in a fresh folder
without sidecar DLLs/config. That startup test exercises embedded assembly loading,
icon loading, and the native loader; it does not open a window or join a room.
`Streamroom.exe --self-test` repeats the startup test (exit 0 means success).

Before distributing, test two Windows machines against the live site: join,
screen/window picker, audio, microphone, playback, stop via picker, closing,
reload, room switching, external links, and missing-runtime handling.
