#!/bin/sh
# Mock `claude` for apicultr integration tests.
# Prints a recognisable marker, echoes any stdin it gets, and stays alive in a read loop
# so process-detection and pane-capture probes have something to find.
#
# Behaviour:
#  - Prints `mock-claude: ready model=<model>` immediately.
#  - Loops reading from stdin: any line received is echoed prefixed with `pasted: `.
#  - Honours `--exit-immediately` for tests that want a dead persona.
#  - Treats `--print-blocked` as a flag that prints a plan-mode-style prompt then waits.

MODEL="(unknown)"
EXIT_IMMEDIATELY=0
PRINT_BLOCKED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --model)
      MODEL="$2"; shift 2 ;;
    --dangerously-skip-permissions)
      shift ;;
    --exit-immediately)
      EXIT_IMMEDIATELY=1; shift ;;
    --print-blocked)
      PRINT_BLOCKED=1; shift ;;
    --version)
      echo "mock-claude 0.0.0"; exit 0 ;;
    *)
      shift ;;
  esac
done

if [ "$EXIT_IMMEDIATELY" = "1" ]; then
  echo "mock-claude: exit-immediately"
  exit 0
fi

echo "mock-claude: ready model=$MODEL"

if [ "$PRINT_BLOCKED" = "1" ]; then
  echo "Do you want to proceed? [y/N]"
fi

# Stay alive, echo whatever comes in.
while IFS= read -r line; do
  echo "pasted: $line"
done
