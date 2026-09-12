# Abre cada .docx con Word (COM), actualiza campos e índice, guarda y cierra.
# Imprime "<archivo>: <páginas> páginas". Lo llama scripts/docs/build-docx.ts.
param([Parameter(Mandatory = $true)][string[]]$Paths)

# El build lee esta salida como UTF-8; sin esto "páginas" llega con acentos rotos.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  foreach ($p in $Paths) {
    $full = (Resolve-Path $p).Path
    $doc = $word.Documents.Open($full, $false, $false)
    try {
      $doc.Fields.Update() | Out-Null
      foreach ($toc in $doc.TablesOfContents) { $toc.Update() | Out-Null }
      $doc.Repaginate()
      $pages = $doc.ComputeStatistics(2)   # 2 = wdStatisticPages
      $doc.Save()
      Write-Output ("{0}: {1} páginas" -f (Split-Path $full -Leaf), $pages)
    } finally {
      $doc.Close(0) | Out-Null
    }
  }
} finally {
  if ($null -ne $word) {
    $word.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
  }
}
