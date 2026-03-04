# ============================================================================
# MAIN — CRON entry point for the WMS Planning Engine
# ============================================================================
#
# Usage:
#   python -m planning_engine.main                  # Live run
#   python -m planning_engine.main --dry-run        # Dry run (no writes)
#   python -m planning_engine.main --log-level DEBUG
#
# Environment:
#   SUPABASE_URL=https://xxxx.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
#
# CRON schedule (recommended):
#   0 2 * * *   cd /path/to/project && python -m planning_engine.main
#
# ============================================================================

import sys
import argparse
from pathlib import Path

# Load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    # Look for .env in the planning_engine directory or project root
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)
except ImportError:
    pass  # dotenv not installed — rely on system env vars

from .config import setup_logging, PlanningConfig
from .engine import PlanningEngine


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="WMS Planning Engine — Commitment-Constrained Min-Max Periodic Review",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m planning_engine.main                    # Standard daily run
  python -m planning_engine.main --dry-run          # Preview without writing
  python -m planning_engine.main --log-level DEBUG  # Verbose output

CRON setup (daily at 2:00 AM):
  0 2 * * * cd /path/to/WMS-AE/WarehouseManagementSystem && python -m planning_engine.main
        """,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Run without inserting notifications or forecasts (preview mode)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (default: INFO)",
    )
    parser.add_argument(
        "--us-warehouse",
        type=str,
        default="WH-US-TRANSIT",
        help="US warehouse code to check stock against (default: WH-US-TRANSIT)",
    )
    return parser.parse_args()


def main() -> int:
    """Entry point. Returns 0 on success, 1 on error."""
    args = parse_args()

    # Setup logging
    logger = setup_logging(args.log_level)

    # Build config
    config = PlanningConfig(
        dry_run=args.dry_run,
        us_warehouse_code=args.us_warehouse,
    )

    # Run engine
    try:
        engine = PlanningEngine(planning_config=config)
        summary = engine.run_daily_cycle()

        if summary.errors > 0:
            logger.warning(f"Completed with {summary.errors} error(s)")
            return 1

        return 0

    except EnvironmentError as e:
        logger.error(f"Configuration error: {e}")
        return 1
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
