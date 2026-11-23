# Khalfoun's hands on the whole computer (Windows): the mouse and the keyboard, as a person
# uses them. One long-lived process: each request is one line of base64 JSON on stdin, each
# answer one line of base64 JSON on stdout. Only the fixed operations below exist; numbers
# and key names are checked, nothing from a request is ever run as code.
# Coordinates are physical screen pixels (the process is DPI aware).

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -Name H -Namespace K -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr extra);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
public struct POINT { public int X; public int Y; }
'@
[void][K.H]::SetProcessDPIAware()

$LEFTDOWN = 0x02; $LEFTUP = 0x04; $RIGHTDOWN = 0x08; $RIGHTUP = 0x10; $MIDDOWN = 0x20; $MIDUP = 0x40; $WHEEL = 0x0800; $HWHEEL = 0x1000
$KEYUP = 0x02; $EXT = 0x01

$VK = @{
  ctrl = 0x11; alt = 0x12; shift = 0x10; win = 0x5B
  enter = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; insert = 0x2D
  home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22; left = 0x25; up = 0x26; right = 0x27; down = 0x28
  printscreen = 0x2C; capslock = 0x14; menu = 0x5D; apps = 0x5D
  plus = 0xBB; equal = 0xBB; minus = 0xBD; comma = 0xBC; period = 0xBE; dot = 0xBE; slash = 0xBF; semicolon = 0xBA; quote = 0xDE
  bracketleft = 0xDB; bracketright = 0xDD; backslash = 0xDC; backquote = 0xC0
  volumemute = 0xAD; volumedown = 0xAE; volumeup = 0xAF; medianext = 0xB0; mediaprev = 0xB1; mediaplay = 0xB3
}
$EXTENDED = @(0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5B, 0x5D)

function Vk-Of([string]$k) {
  $k = $k.ToLowerInvariant()
  if ($VK.ContainsKey($k)) { return [int]$VK[$k] }
  if ($k -match '^[a-z]$') { return [int][char]$k.ToUpperInvariant() }
  if ($k -match '^[0-9]$') { return [int][char]$k }
  if ($k -match '^f([1-9]|1[0-2])$') { return 0x6F + [int]$Matches[1] }
  throw 'bad_key'
}

function Key-Down([int]$vk) { $f = 0; if ($EXTENDED -contains $vk) { $f = $EXT }; [K.H]::keybd_event([byte]$vk, 0, $f, [UIntPtr]::Zero) }
function Key-Up([int]$vk) { $f = $KEYUP; if ($EXTENDED -contains $vk) { $f = $f -bor $EXT }; [K.H]::keybd_event([byte]$vk, 0, $f, [UIntPtr]::Zero) }

function Press([string]$combo, [int]$times) {
  $parts = @($combo.Split('+') | Where-Object { $_ -ne '' })
  if ($parts.Count -lt 1 -or $parts.Count -gt 4) { throw 'bad_key' }
  $vks = @($parts | ForEach-Object { Vk-Of $_ })
  for ($n = 0; $n -lt [Math]::Max(1, [Math]::Min(50, $times)); $n++) {
    foreach ($v in $vks) { Key-Down $v; Start-Sleep -Milliseconds 12 }
    [array]::Reverse($vks)
    foreach ($v in $vks) { Key-Up $v; Start-Sleep -Milliseconds 8 }
    [array]::Reverse($vks)
    Start-Sleep -Milliseconds 25
  }
}

function Check-Point($x, $y) {
  $x = [int]$x; $y = [int]$y
  $vx = [K.H]::GetSystemMetrics(76); $vy = [K.H]::GetSystemMetrics(77); $vw = [K.H]::GetSystemMetrics(78); $vh = [K.H]::GetSystemMetrics(79)
  if ($x -lt $vx -or $y -lt $vy -or $x -ge ($vx + $vw) -or $y -ge ($vy + $vh)) { throw 'off_screen' }
  return @($x, $y)
}

function Mouse-Flags([string]$button) {
  switch ($button) {
    'right' { return @($RIGHTDOWN, $RIGHTUP) }
    'middle' { return @($MIDDOWN, $MIDUP) }
    default { return @($LEFTDOWN, $LEFTUP) }
  }
}

function Click($a) {
  $p = Check-Point $a.x $a.y
  [void][K.H]::SetCursorPos($p[0], $p[1])
  Start-Sleep -Milliseconds 40
  $f = Mouse-Flags ([string]$a.button)
  $count = 1; if ($a.double) { $count = 2 }; if ($a.triple) { $count = 3 }
  $mods = @(); if ($a.modifiers) { $mods = @(([string]$a.modifiers).Split('+') | Where-Object { $_ } | ForEach-Object { Vk-Of $_ }) }
  foreach ($m in $mods) { Key-Down $m }
  for ($i = 0; $i -lt $count; $i++) {
    [K.H]::mouse_event($f[0], 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30
    [K.H]::mouse_event($f[1], 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  }
  foreach ($m in $mods) { Key-Up $m }
}

function Drag($a) {
  $p1 = Check-Point $a.x1 $a.y1; $p2 = Check-Point $a.x2 $a.y2
  [void][K.H]::SetCursorPos($p1[0], $p1[1]); Start-Sleep -Milliseconds 60
  [K.H]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80
  $steps = 24
  for ($i = 1; $i -le $steps; $i++) {
    $x = [int]($p1[0] + ($p2[0] - $p1[0]) * $i / $steps); $y = [int]($p1[1] + ($p2[1] - $p1[1]) * $i / $steps)
    [void][K.H]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 12
  }
  Start-Sleep -Milliseconds 60
  [K.H]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-Answer($id, [bool]$ok, $data, [string]$err) {
  $o = [ordered]@{ id = $id; ok = $ok; data = $data; error = $err }
  $json = $o | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  try {
    $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $id = $req.id
    $a = $req.args
    $data = $null
    switch ([string]$req.op) {
      'ping' { $data = 'pong' }
      'click' { Click $a }
      'move' { $p = Check-Point $a.x $a.y; [void][K.H]::SetCursorPos($p[0], $p[1]) }
      'drag' { Drag $a }
      'scroll' {
        $p = Check-Point $a.x $a.y; [void][K.H]::SetCursorPos($p[0], $p[1]); Start-Sleep -Milliseconds 40
        $n = [Math]::Max(1, [Math]::Min(30, [int]$a.amount))
        $flag = $WHEEL; $sign = 1
        switch ([string]$a.direction) { 'down' { $sign = -1 } 'left' { $flag = $HWHEEL; $sign = -1 } 'right' { $flag = $HWHEEL } }
        for ($i = 0; $i -lt $n; $i++) { [K.H]::mouse_event($flag, 0, 0, 120 * $sign, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
      }
      'keys' { Press ([string]$a.keys) ([int]$a.times) }
      'cursor' { $pt = New-Object K.H+POINT; [void][K.H]::GetCursorPos([ref]$pt); $data = @{ x = $pt.X; y = $pt.Y } }
      default { throw 'bad_op' }
    }
    Send-Answer $id $true $data ''
  } catch {
    $msg = [string]$_.Exception.Message
    if ($msg -notmatch '^(bad_op|bad_key|off_screen)$') { $msg = 'input: ' + $msg }
    Send-Answer $id $false $null $msg
  }
}
