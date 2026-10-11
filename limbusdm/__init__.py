__version__ = "0.11.81"
APP_TITLE = "Limbus Archive"
APP_EXE = "LimbusArchive.exe"
OLD_EXE = "LimbusDatamine.exe"  # the app's name before 0.4.0
REPO = "Schirke/limbus-archive"
TEST_BUILD, TEST_N = "", 0  # test build tag (v<ver>-<name><n>); "" in a stable release

# Versus rules live in the player's repo (unity/LimbusViewer/Versus); a release carries them compiled
import os as _os
_VS = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "unity", "LimbusViewer", "Versus")
if _os.path.isdir(_VS):
    __path__.append(_VS)
