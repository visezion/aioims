"""Create the current AIMS schema.

The application metadata is intentionally used here so a clean deployment can
bootstrap the complete schema. Future changes should be generated as explicit
Alembic revisions and should not rely on create_all.
"""

from alembic import op
from app.db.session import Base
from app.models import alert, app_config, audit_log, credential_profile, device, device_config_backup, device_link, governance, incident, insight, job, site, trace_snapshot, user, wireless_snapshot  # noqa: F401

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
