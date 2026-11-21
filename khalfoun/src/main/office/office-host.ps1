# Khalfoun's hands inside Word, PowerPoint and Excel (Windows, through COM).
# Runs as one long-lived process: each request is one line of base64 JSON on stdin,
# each answer one line of base64 JSON on stdout. Requests only name fixed operations
# (switch below); text from the person is only ever put into documents as text,
# never run as code.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$wdStyleNormal = -1; $wdStyleHeading1 = -2; $wdStyleTitle = -63
$wdToggle = 9999998
$ppLayoutText = 2; $ppLayoutTitleOnly = 11; $ppLayoutBlank = 12
$msoTrue = -1; $msoFalse = 0

function Get-App([string]$progId) {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject($progId) } catch { return $null }
}

function Send-Answer($id, [bool]$ok, $data, [string]$err) {
  $o = [ordered]@{ id = $id; ok = $ok; data = $data; error = $err }
  $json = $o | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  [Console]::Out.Flush()
}

# Which Office program the person is working in: the one named, else the one in front.
function Resolve-Target($a) {
  $app = [string]$a.app
  if (-not $app) {
    switch -Regex ([string]$a.process) {
      '^WINWORD$' { $app = 'word' }
      '^POWERPNT$' { $app = 'powerpoint' }
      '^EXCEL$' { $app = 'excel' }
    }
  }
  if (-not $app) { throw 'no_office' }
  $obj = $null
  if ($app -eq 'word') { $obj = Get-App 'Word.Application' }
  elseif ($app -eq 'powerpoint') { $obj = Get-App 'PowerPoint.Application' }
  elseif ($app -eq 'excel') { $obj = Get-App 'Excel.Application' }
  else { throw 'no_office' }
  if ($null -eq $obj) { throw 'not_running' }
  return @{ app = $app; obj = $obj }
}

function Has-Document($t) {
  try {
    if ($t.app -eq 'word') { return $t.obj.Documents.Count -gt 0 }
    if ($t.app -eq 'powerpoint') { return $t.obj.Presentations.Count -gt 0 }
    if ($t.app -eq 'excel') { return $t.obj.Workbooks.Count -gt 0 }
  } catch { }
  return $false
}

# ---------------------------------------------------------------- Word

function Word-Doc($w) {
  if ($w.Documents.Count -eq 0) { [void]$w.Documents.Add() }
  return $w.ActiveDocument
}

function Word-Line($w, [string]$text, [int]$style, [hashtable]$opt) {
  $sel = $w.Selection
  $doc = $w.ActiveDocument
  $sel.Style = $doc.Styles.Item($style)
  $sel.ParagraphFormat.ReadingOrder = 0   # right to left
  if ($opt.center) { $sel.ParagraphFormat.Alignment = 1 }
  if ($opt.bold) { $sel.Font.Bold = 1 }
  if ($opt.color) { $sel.Font.Color = [int]$opt.color }
  if ($opt.size) { $sel.Font.Size = [int]$opt.size }
  $sel.TypeText($text)
  $sel.TypeParagraph()
  $sel.Font.Bold = 0
  $sel.Font.Color = -16777216   # automatic
  $sel.Style = $doc.Styles.Item($wdStyleNormal)
}

function Word-List($w, $items, [bool]$numbered) {
  $sel = $w.Selection
  $start = $sel.Range.Start
  foreach ($it in $items) { $sel.ParagraphFormat.ReadingOrder = 0; $sel.TypeText([string]$it); $sel.TypeParagraph() }
  $r = $w.ActiveDocument.Range($start, [Math]::Max($start, $sel.Range.Start - 1))
  if ($numbered) { $r.ListFormat.ApplyNumberDefault() } else { $r.ListFormat.ApplyBulletDefault() }
  $sel.Range.ListFormat.RemoveNumbers()
}

function Word-Table($w, $columns, $rows, [int]$headColor) {
  $doc = $w.ActiveDocument
  $sel = $w.Selection
  $t = $doc.Tables.Add($sel.Range, $rows.Count + 1, $columns.Count)
  $t.Borders.Enable = $true
  try { $t.TableDirection = 0 } catch { }   # right to left
  for ($c = 0; $c -lt $columns.Count; $c++) {
    $cell = $t.Cell(1, $c + 1).Range
    $cell.Text = [string]$columns[$c]
    $cell.Font.Bold = 1
    $cell.Font.Color = 16777215
    $cell.Shading.BackgroundPatternColor = $headColor
    $cell.ParagraphFormat.Alignment = 1
  }
  for ($r = 0; $r -lt $rows.Count; $r++) {
    $row = $rows[$r]
    for ($c = 0; $c -lt $columns.Count; $c++) {
      $cell = $t.Cell($r + 2, $c + 1).Range
      $cell.Text = [string]$row[$c]
      $cell.ParagraphFormat.Alignment = 1
    }
  }
  $t.AutoFitBehavior(1)
  $sel.EndKey(6) | Out-Null
  $sel.TypeParagraph()
}

function Word-Insert($w, $p, $c) {
  [void](Word-Doc $w)
  if ($p.title) { Word-Line $w $p.title $wdStyleTitle @{ center = $true; color = $c.primary } }
  if ($p.kind -eq 'table') { Word-Table $w $p.columns $p.rows $c.primary; return }
  if ($p.kind -eq 'slides') {
    foreach ($s in $p.slides) { Word-Line $w $s.title $wdStyleHeading1 @{}; Word-List $w $s.bullets $false }
    return
  }
  if ($p.kind -eq 'diagram') { foreach ($n in $p.nodes) { Word-Line $w ('• ' + $n.text) $wdStyleNormal @{} }; return }
  $answers = @()
  foreach ($b in $p.blocks) {
    switch ([string]$b.type) {
      'heading' { Word-Line $w $b.text $wdStyleHeading1 @{} }
      'paragraph' { Word-Line $w $b.text $wdStyleNormal @{} }
      'bullets' { Word-List $w $b.items $false }
      'numbered' { Word-List $w $b.items $true }
      'moral' { Word-Line $w ($c.moral + ' ' + $b.text) $wdStyleNormal @{ bold = $true; color = $c.green } }
      'questions' {
        $i = 0
        foreach ($q in $b.items) {
          $i++
          Word-Line $w ((Num $i $c) + '. ' + $q.q) $wdStyleNormal @{ bold = $true }
          if ($q.choices -and $q.choices.Count -gt 0) {
            $letters = @('أ', 'ب', 'ج', 'د', 'هـ', 'و')
            $line = ''
            for ($k = 0; $k -lt $q.choices.Count; $k++) { $line += $letters[$k] + ') ' + $q.choices[$k] + '      ' }
            Word-Line $w $line.Trim() $wdStyleNormal @{}
          } else {
            $n = [Math]::Max(1, [int]$q.lines)
            for ($l = 0; $l -lt $n; $l++) { Word-Line $w ('.' * 90) $wdStyleNormal @{ color = 9480376 } }
          }
          $answers += [string]$q.answer
        }
      }
    }
  }
}

function Num([int]$n, $c) {
  $s = [string]$n
  if ($c.digits -eq 'arabic') { $d = '٠١٢٣٤٥٦٧٨٩'; $o = ''; foreach ($ch in $s.ToCharArray()) { $o += $d[[int][string]$ch] }; return $o }
  return $s
}

# ---------------------------------------------------------------- PowerPoint

function Ppt-Pres($pp) {
  if ($pp.Presentations.Count -eq 0) { [void]$pp.Presentations.Add() }
  return $pp.ActivePresentation
}

function Ppt-CurrentIndex($pp) {
  try { return [int]$pp.ActiveWindow.View.Slide.SlideIndex } catch { return 0 }
}

function Ppt-RTL($tr) {
  try { $tr.ParagraphFormat.TextDirection = 2 } catch { }
  try { $tr.ParagraphFormat.Alignment = 3 } catch { }
}

function Ppt-AddSlide($pp, [int]$layout) {
  $pres = Ppt-Pres $pp
  $at = (Ppt-CurrentIndex $pp) + 1
  if ($at -lt 1) { $at = $pres.Slides.Count + 1 }
  $s = $pres.Slides.Add($at, $layout)
  try { $pp.ActiveWindow.View.GotoSlide($at) } catch { }
  return $s
}

function Ppt-TextSlide($pp, [string]$title, $lines) {
  $s = Ppt-AddSlide $pp $ppLayoutText
  $s.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $title
  Ppt-RTL $s.Shapes.Placeholders.Item(1).TextFrame.TextRange
  $body = $s.Shapes.Placeholders.Item(2).TextFrame.TextRange
  $body.Text = ($lines -join "`r")
  Ppt-RTL $body
  return $s
}

function Ppt-Insert($pp, $p, $c) {
  [void](Ppt-Pres $pp)
  switch ([string]$p.kind) {
    'slides' {
      $first = Ppt-AddSlide $pp 1
      $first.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $p.title
      try { $first.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $p.subtitle } catch { }
      foreach ($s in $p.slides) { [void](Ppt-TextSlide $pp $s.title $s.bullets) }
    }
    'table' {
      $s = Ppt-AddSlide $pp $ppLayoutTitleOnly
      $s.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $p.title
      $sw = $pp.ActivePresentation.PageSetup.SlideWidth
      $tbl = $s.Shapes.AddTable($p.rows.Count + 1, $p.columns.Count, 40, 120, $sw - 80, 40).Table
      for ($k = 0; $k -lt $p.columns.Count; $k++) { $tbl.Cell(1, $k + 1).Shape.TextFrame.TextRange.Text = [string]$p.columns[$k] }
      for ($r = 0; $r -lt $p.rows.Count; $r++) { for ($k = 0; $k -lt $p.columns.Count; $k++) { $tbl.Cell($r + 2, $k + 1).Shape.TextFrame.TextRange.Text = [string]$p.rows[$r][$k] } }
      try { $tbl.TableDirection = 2 } catch { }
    }
    'diagram' {
      $s = Ppt-AddSlide $pp $ppLayoutTitleOnly
      $s.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $p.title
      Draw-On $pp.ActivePresentation $s.Shapes $c.items $true
    }
    default {
      $title = [string]$p.title
      $lines = @()
      foreach ($b in $p.blocks) {
        switch ([string]$b.type) {
          'heading' { if ($lines.Count -gt 0 -or $title) { [void](Ppt-TextSlide $pp $title $lines); $lines = @() }; $title = [string]$b.text }
          'paragraph' { $lines += [string]$b.text }
          'moral' { $lines += [string]$b.text }
          'bullets' { $lines += $b.items }
          'numbered' { $lines += $b.items }
          'questions' { foreach ($q in $b.items) { $lines += [string]$q.q } }
        }
      }
      if ($lines.Count -gt 0 -or $title) {
        if ($p.verbatim -and $lines.Count -eq 0) { $s = Ppt-AddSlide $pp $ppLayoutTitleOnly; $s.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $title }
        else { [void](Ppt-TextSlide $pp $title $lines) }
      }
    }
  }
}

# Shapes on a PowerPoint slide (or a Word canvas): items have fractions of the drawing area.
function Draw-On($pres, $shapes, $items, [bool]$underTitle) {
  $W = 720; $H = 405; $X0 = 0; $Y0 = 0
  if ($pres) { $W = $pres.PageSetup.SlideWidth; $H = $pres.PageSetup.SlideHeight }
  if ($underTitle) { $X0 = 40; $Y0 = 110; $W = $W - 80; $H = $H - 140 }
  $made = 0
  foreach ($it in $items) {
    if ($it.kind -eq 'arrow') {
      $ln = $shapes.AddLine($X0 + $it.x1 * $W, $Y0 + $it.y1 * $H, $X0 + $it.x2 * $W, $Y0 + $it.y2 * $H)
      $ln.Line.ForeColor.RGB = [int]$it.line
      $ln.Line.Weight = 2.5
      $ln.Line.EndArrowheadStyle = 2
    } elseif ($it.kind -eq 'line') {
      $ln = $shapes.AddLine($X0 + $it.x * $W, $Y0 + $it.y * $H, $X0 + ($it.x + $it.w) * $W, $Y0 + $it.y * $H)
      $ln.Line.ForeColor.RGB = [int]$it.fill
      $ln.Line.Weight = 4
    } else {
      $sh = $shapes.AddShape([int]$it.type, $X0 + $it.x * $W, $Y0 + $it.y * $H, $it.w * $W, $it.h * $H)
      $sh.Fill.ForeColor.RGB = [int]$it.fill
      $sh.Line.ForeColor.RGB = [int]$it.line
      if ($it.text) {
        $tr = $sh.TextFrame.TextRange
        $tr.Text = [string]$it.text
        $tr.Font.Color.RGB = [int]$it.textColor
        $tr.Font.Bold = $msoTrue
        try { $tr.ParagraphFormat.Alignment = 2 } catch { }
        try { $tr.ParagraphFormat.TextDirection = 2 } catch { }
      }
    }
    $made++
  }
  return $made
}

# ---------------------------------------------------------------- Excel

function Excel-Insert($x, $p, $c) {
  if ($x.Workbooks.Count -eq 0) { [void]$x.Workbooks.Add() }
  $ws = $x.ActiveSheet
  try { $ws.DisplayRightToLeft = $true } catch { }
  $start = $x.ActiveCell
  $r0 = $start.Row; $c0 = $start.Column
  if ($p.kind -eq 'table') {
    $cols = $p.columns; $rows = $p.rows
    if ($p.title) { $ws.Cells.Item($r0, $c0).Value2 = [string]$p.title; $ws.Cells.Item($r0, $c0).Font.Bold = $true; $ws.Cells.Item($r0, $c0).Font.Size = 14; $r0 += 2 }
    for ($k = 0; $k -lt $cols.Count; $k++) {
      $cell = $ws.Cells.Item($r0, $c0 + $k)
      $cell.Value2 = [string]$cols[$k]
      $cell.Font.Bold = $true; $cell.Font.Color = 16777215; $cell.Interior.Color = $c.primary; $cell.HorizontalAlignment = -4108
    }
    for ($r = 0; $r -lt $rows.Count; $r++) { for ($k = 0; $k -lt $cols.Count; $k++) { $ws.Cells.Item($r0 + 1 + $r, $c0 + $k).Value2 = $rows[$r][$k] } }
    $rng = $ws.Range($ws.Cells.Item($r0, $c0), $ws.Cells.Item($r0 + $rows.Count, $c0 + $cols.Count - 1))
    $rng.Borders.LineStyle = 1
    $rng.Columns.AutoFit() | Out-Null
  } else {
    $r = $r0
    foreach ($line in $c.lines) { $ws.Cells.Item($r, $c0).Value2 = [string]$line; $r++ }
  }
}

# ---------------------------------------------------------------- formatting

function Format-Word($w, $a) {
  $sel = $w.Selection
  switch ([string]$a.op) {
    'bold' { $sel.Font.Bold = $wdToggle }
    'italic' { $sel.Font.Italic = $wdToggle }
    'underline' { $sel.Font.Underline = $wdToggle }
    'grow' { $sel.Font.Grow() }
    'shrink' { $sel.Font.Shrink() }
    'size' { $sel.Font.Size = [int]$a.value }
    'color' { $sel.Font.Color = [int]$a.rgb }
    'center' { $sel.ParagraphFormat.Alignment = 1 }
    'right' { $sel.ParagraphFormat.Alignment = 2 }
    'left' { $sel.ParagraphFormat.Alignment = 0 }
    'heading' { $sel.Style = $w.ActiveDocument.Styles.Item($wdStyleHeading1) }
    'bullets' { $sel.Range.ListFormat.ApplyBulletDefault() }
    'numbers' { $sel.Range.ListFormat.ApplyNumberDefault() }
    'highlight' { $sel.Range.HighlightColorIndex = 7 }
    default { throw 'bad_op' }
  }
}

function Ppt-TextOf($pp) {
  $sel = $pp.ActiveWindow.Selection
  if ($sel.Type -eq 3) { return @{ tr = $sel.TextRange; shapes = $null } }
  if ($sel.Type -eq 2) { return @{ tr = $sel.ShapeRange.TextFrame.TextRange; shapes = $sel.ShapeRange } }
  throw 'no_selection'
}

function Format-Ppt($pp, $a) {
  $t = Ppt-TextOf $pp
  $tr = $t.tr
  switch ([string]$a.op) {
    'bold' { if ($tr.Font.Bold -eq $msoTrue) { $tr.Font.Bold = $msoFalse } else { $tr.Font.Bold = $msoTrue } }
    'italic' { if ($tr.Font.Italic -eq $msoTrue) { $tr.Font.Italic = $msoFalse } else { $tr.Font.Italic = $msoTrue } }
    'underline' { if ($tr.Font.Underline -eq $msoTrue) { $tr.Font.Underline = $msoFalse } else { $tr.Font.Underline = $msoTrue } }
    'grow' { $tr.Font.Size = $tr.Font.Size + 4 }
    'shrink' { $tr.Font.Size = [Math]::Max(8, $tr.Font.Size - 4) }
    'size' { $tr.Font.Size = [int]$a.value }
    'color' { if ($t.shapes -and $pp.ActiveWindow.Selection.Type -eq 2 -and -not $tr.Text) { $t.shapes.Fill.ForeColor.RGB = [int]$a.rgb } else { $tr.Font.Color.RGB = [int]$a.rgb } }
    'center' { $tr.ParagraphFormat.Alignment = 2 }
    'right' { $tr.ParagraphFormat.Alignment = 3 }
    'left' { $tr.ParagraphFormat.Alignment = 1 }
    'heading' { $tr.Font.Size = 40; $tr.Font.Bold = $msoTrue }
    'bullets' { $tr.ParagraphFormat.Bullet.Visible = $msoTrue }
    'numbers' { $tr.ParagraphFormat.Bullet.Visible = $msoTrue; $tr.ParagraphFormat.Bullet.Type = 2 }
    'highlight' { $tr.Font.Color.RGB = 49407 }
    default { throw 'bad_op' }
  }
}

function Format-Excel($x, $a) {
  $sel = $x.Selection
  switch ([string]$a.op) {
    'bold' { $sel.Font.Bold = -not $sel.Font.Bold }
    'italic' { $sel.Font.Italic = -not $sel.Font.Italic }
    'underline' { if ($sel.Font.Underline -eq 2) { $sel.Font.Underline = -4142 } else { $sel.Font.Underline = 2 } }
    'grow' { $sel.Font.Size = $sel.Font.Size + 2 }
    'shrink' { $sel.Font.Size = [Math]::Max(8, $sel.Font.Size - 2) }
    'size' { $sel.Font.Size = [int]$a.value }
    'color' { $sel.Font.Color = [int]$a.rgb }
    'center' { $sel.HorizontalAlignment = -4108 }
    'right' { $sel.HorizontalAlignment = -4152 }
    'left' { $sel.HorizontalAlignment = -4131 }
    'heading' { $sel.Font.Bold = $true; $sel.Font.Size = 16 }
    'highlight' { $sel.Interior.Color = 65535 }
    default { throw 'bad_op' }
  }
}

# ---------------------------------------------------------------- a circle around the selection

function Circle-Word($w, [int]$red) {
  $sel = $w.Selection
  if ($sel.Start -eq $sel.End) { throw 'no_selection' }
  $x1 = [double]$sel.Information(5); $y1 = [double]$sel.Information(6)
  $e = $sel.Range.Duplicate; $e.Collapse(0)
  $x2 = [double]$e.Information(5); $y2 = [double]$e.Information(6)
  $size = [double]$sel.Font.Size; if ($size -le 0 -or $size -gt 200) { $size = 14 }
  $left = [Math]::Min($x1, $x2); $width = [Math]::Max(40, [Math]::Abs($x2 - $x1))
  $top = [Math]::Min($y1, $y2); $height = [Math]::Abs($y2 - $y1) + $size * 1.5
  if ([Math]::Abs($y2 - $y1) -gt 2) { $left = 60; $width = $w.ActiveDocument.PageSetup.PageWidth - 120 }   # several lines: the whole width
  $sh = $w.ActiveDocument.Shapes.AddShape(9, $left - 8, $top - 6, $width + 16, $height + 6, $sel.Range)
  $sh.RelativeHorizontalPosition = 1; $sh.RelativeVerticalPosition = 1
  $sh.Left = $left - 8; $sh.Top = $top - 6
  $sh.Fill.Visible = 0
  $sh.Line.ForeColor.RGB = $red
  $sh.Line.Weight = 2.5
  $sh.WrapFormat.Type = 3   # in front of the text
}

function Circle-Ppt($pp, [int]$red) {
  $sel = $pp.ActiveWindow.Selection
  $slide = $pp.ActiveWindow.View.Slide
  if ($sel.Type -eq 3) { $tr = $sel.TextRange; $l = $tr.BoundLeft; $t = $tr.BoundTop; $w = $tr.BoundWidth; $h = $tr.BoundHeight }
  elseif ($sel.Type -eq 2) { $sr = $sel.ShapeRange; $l = $sr.Left; $t = $sr.Top; $w = $sr.Width; $h = $sr.Height }
  else { throw 'no_selection' }
  $sh = $slide.Shapes.AddShape(9, $l - 10, $t - 8, $w + 20, $h + 16)
  $sh.Fill.Visible = $msoFalse
  $sh.Line.ForeColor.RGB = $red
  $sh.Line.Weight = 3
}

# ---------------------------------------------------------------- equations

function Equation-Word($w, [string]$linear, [string]$shown) {
  [void](Word-Doc $w)
  $sel = $w.Selection
  $r = $sel.Range
  $r.Text = $linear
  try { $m = $w.ActiveDocument.OMaths.Add($r); $m.OMaths.Item(1).BuildUp() } catch { $r.Text = $shown }
  $sel.EndKey(5) | Out-Null
  $sel.TypeParagraph()
}

function Equation-Ppt($pp, [string]$shown) {
  [void](Ppt-Pres $pp)
  $slide = $pp.ActiveWindow.View.Slide
  $sw = $pp.ActivePresentation.PageSetup.SlideWidth; $shH = $pp.ActivePresentation.PageSetup.SlideHeight
  $box = $slide.Shapes.AddTextbox(1, 60, $shH / 2 - 40, $sw - 120, 80)
  $tr = $box.TextFrame.TextRange
  $tr.Text = $shown
  $tr.Font.Name = 'Cambria Math'
  $tr.Font.Size = 44
  $tr.ParagraphFormat.Alignment = 2
}

# ---------------------------------------------------------------- the loop

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
      'status' {
        try { $t = Resolve-Target $a; $data = @{ app = $t.app; hasDoc = (Has-Document $t) } } catch { $data = @{ app = $null; hasDoc = $false; why = $_.Exception.Message } }
      }
      'insert' {
        $t = Resolve-Target $a
        if ($t.app -eq 'word') { Word-Insert $t.obj $a.plan $a.c }
        elseif ($t.app -eq 'powerpoint') { Ppt-Insert $t.obj $a.plan $a.c }
        else { Excel-Insert $t.obj $a.plan $a.c }
        $data = @{ app = $t.app }
      }
      'draw' {
        $t = Resolve-Target $a
        if ($t.app -eq 'powerpoint') {
          [void](Ppt-Pres $t.obj)
          $slide = $t.obj.ActiveWindow.View.Slide
          $n = Draw-On $t.obj.ActivePresentation $slide.Shapes $a.items $false
        } elseif ($t.app -eq 'word') {
          $doc = Word-Doc $t.obj
          $canvas = $doc.Shapes.AddCanvas(0, 0, 440, 260, $t.obj.Selection.Range)
          try { $canvas.WrapFormat.Type = 7 } catch { }
          $n = Draw-On $null $canvas.CanvasItems $a.items $false
        } else {
          $ws = $t.obj.ActiveSheet
          $n = Draw-On $null $ws.Shapes $a.items $false
        }
        $data = @{ app = $t.app; shapes = $n }
      }
      'format' {
        $t = Resolve-Target $a
        if ($t.app -eq 'word') { Format-Word $t.obj $a } elseif ($t.app -eq 'powerpoint') { Format-Ppt $t.obj $a } else { Format-Excel $t.obj $a }
        $data = @{ app = $t.app }
      }
      'circle' {
        $t = Resolve-Target $a
        if ($t.app -eq 'word') { Circle-Word $t.obj ([int]$a.red) } elseif ($t.app -eq 'powerpoint') { Circle-Ppt $t.obj ([int]$a.red) } else { throw 'no_office' }
        $data = @{ app = $t.app }
      }
      'slide' {
        $a | Add-Member -NotePropertyName app -NotePropertyValue 'powerpoint' -Force
        $t = Resolve-Target $a
        if ([string]$a.title) { $s = Ppt-AddSlide $t.obj $ppLayoutTitleOnly; $s.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = [string]$a.title; Ppt-RTL $s.Shapes.Placeholders.Item(1).TextFrame.TextRange }
        else { [void](Ppt-AddSlide $t.obj $ppLayoutText) }
        $data = @{ app = 'powerpoint' }
      }
      'equation' {
        $t = Resolve-Target $a
        if ($t.app -eq 'word') { Equation-Word $t.obj ([string]$a.linear) ([string]$a.text) }
        elseif ($t.app -eq 'powerpoint') { Equation-Ppt $t.obj ([string]$a.text) }
        else { $t.obj.ActiveCell.Value2 = [string]$a.text }
        $data = @{ app = $t.app }
      }
      'pdf' {
        $t = Resolve-Target $a
        $path = [string]$a.path
        if ($t.app -eq 'word') { $t.obj.ActiveDocument.ExportAsFixedFormat($path, 17) }
        elseif ($t.app -eq 'powerpoint') { $t.obj.ActivePresentation.SaveCopyAs($path, 32) }
        else { $t.obj.ActiveWorkbook.ExportAsFixedFormat(0, $path) }
        $data = @{ app = $t.app; file = $path }
      }
      default { throw 'bad_op' }
    }
    Send-Answer $id $true $data ''
  } catch {
    $msg = [string]$_.Exception.Message
    if ($msg -notmatch '^(no_office|not_running|no_selection|bad_op)$') { $msg = 'com: ' + $msg }
    Send-Answer $id $false $null $msg
  }
}
