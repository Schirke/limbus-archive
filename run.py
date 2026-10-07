"""Entry point for the packaged exe (and `uv run run.py`)."""
from multiprocessing import freeze_support

if __name__ == "__main__":
    freeze_support()  # snapshot workers are separate processes of the same exe
    from limbusdm.app import main

    main()
