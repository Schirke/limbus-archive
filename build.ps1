# Builds LimbusArchive\LimbusArchive.exe (needs uv: https://docs.astral.sh/uv/)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Get-Process LimbusArchive, LimbusDatamine -ErrorAction SilentlyContinue | Stop-Process -Force
uv sync
uv run python -c "from limbusdm.icon import save_ico; save_ico('ui/icon.ico')"
# Versus rules: in the player's repo (unity\LimbusViewer\Versus), shipped compiled (Cython + VS Build Tools C++)
$pyd = @()
if (Test-Path "unity\LimbusViewer\Versus") {
  Remove-Item "build\versus" -Recurse -Force -ErrorAction SilentlyContinue
  uv run --with cython --with setuptools python scripts\build_versus.py unity\LimbusViewer\Versus build\versus
  if ($LASTEXITCODE -ne 0) { throw "Versus rules failed to compile" }
  $pyd = Copy-Item "build\versus\limbusdm\*.pyd" limbusdm -PassThru
} else {
  Write-Warning "Versus rules not found (unity\LimbusViewer\Versus): Versus will be off"
}
try {
  uv run pyinstaller --noconfirm --clean --windowed --name LimbusArchive --icon ui/icon.ico `
    --distpath . --workpath build `
    --add-data "ui;ui" `
    --collect-all UnityPy --collect-all fmod_toolkit --collect-all pyfmodex `
    --collect-all texture2ddecoder --collect-all etcpak --collect-all astc_encoder --collect-all archspec `
    --collect-all webview --collect-all clr_loader --collect-all pythonnet --collect-all imageio_ffmpeg `
    run.py
} finally {
  $pyd | Remove-Item -ErrorAction SilentlyContinue
}
Remove-Item LimbusArchive.spec -ErrorAction SilentlyContinue

# Skill renders with the game's effects: the Unity player. Its project is a repository of its own (not public), cloned
# into unity\LimbusViewer; it is built with Unity 6000.3.12f1 (the game's version, with the Windows IL2CPP module) when
# both are there; the player goes next to the app
$unity = "C:\Program Files\Unity\Hub\Editor\6000.3.12f1\Editor\Editor\Unity.exe"
if (-not (Test-Path $unity)) { $unity = "C:\Program Files\Unity\Hub\Editor\6000.3.12f1\Editor\Unity.exe" }
if ((Test-Path $unity) -and (Test-Path "unity\LimbusViewer\Assets")) {
  & $unity -batchmode -quit -projectPath "$PSScriptRoot\unity\LimbusViewer" -executeMethod Build.Player -logFile "$PSScriptRoot\build\unity.log" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "LimbusViewer build failed, see build\unity.log" }
}
$viewer = "unity\LimbusViewer\Build"
if (Test-Path "$viewer\LimbusViewer.exe") {
  Remove-Item "LimbusArchive\LimbusViewer" -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item $viewer "LimbusArchive\LimbusViewer" -Recurse -Force
  # (the IL2CPP build's backup folder is 900 MB of intermediate C++)
  Remove-Item "LimbusArchive\LimbusViewer\*_DoNotShip", "LimbusArchive\LimbusViewer\*_BackUpThisFolder_ButDontShipItWithYourGame" -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Warning "LimbusViewer not built (needs its project and Unity 6000.3.12f1): skill renders with effects will be off"
}
Write-Host "Built: $PSScriptRoot\LimbusArchive\LimbusArchive.exe"
