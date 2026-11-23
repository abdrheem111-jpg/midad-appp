// The long-lived PowerShell that tells Khalfoun which window is in front (process, window
// handle, title), and brings a given window back to the front: «act <pid>» by program,
// «acth <hwnd>» the exact window. One line in, one line out: "pid\tprocess\thwnd\ttitle".

export const FG_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ws = New-Object -ComObject WScript.Shell
Add-Type -Name F -Namespace K -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ($line -match '^act (\\d+)$') { try { [void]$ws.AppActivate([int]$Matches[1]); Start-Sleep -Milliseconds 120 } catch {} }
  if ($line -match '^acth (\\d+)$') {
    # The exact window (a program can have several, like Notepad). No key is sent (an Alt
    # tap put Notepad in menu mode and the paste was lost): this thread shares the input
    # of the window in front for a moment, which lets Windows hand the foreground over.
    try {
      $w = [IntPtr][long]$Matches[1]
      if ([K.F]::IsWindow($w)) {
        if ([K.F]::IsIconic($w)) { [void][K.F]::ShowWindow($w, 9) }
        $fgw = [K.F]::GetForegroundWindow(); $x = 0
        $fgt = [K.F]::GetWindowThreadProcessId($fgw, [ref]$x)
        $me = [K.F]::GetCurrentThreadId()
        $att = $false
        if ($fgt -ne 0 -and $fgt -ne $me) { $att = [K.F]::AttachThreadInput($me, $fgt, $true) }
        [void][K.F]::BringWindowToTop($w)
        [void][K.F]::SetForegroundWindow($w)
        if ($att) { [void][K.F]::AttachThreadInput($me, $fgt, $false) }
        Start-Sleep -Milliseconds 80
        if ([K.F]::GetForegroundWindow() -ne $w) {
          # Second try: an unassigned key (0xE8, means nothing to any program) counts as input.
          [K.F]::keybd_event(0xE8, 0, 0, [UIntPtr]::Zero); [K.F]::keybd_event(0xE8, 0, 2, [UIntPtr]::Zero)
          [void][K.F]::SetForegroundWindow($w)
        }
        Start-Sleep -Milliseconds 80
      }
    } catch {}
  }
  $h = [K.F]::GetForegroundWindow(); $p = 0; [void][K.F]::GetWindowThreadProcessId($h, [ref]$p)
  $sb = New-Object System.Text.StringBuilder 512; [void][K.F]::GetWindowText($h, $sb, 512)
  $n = ''; try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine("$p\t$n\t$([long]$h)\t" + ($sb.ToString() -replace '[\r\n\t]', ' ')); [Console]::Out.Flush()
}
`;
