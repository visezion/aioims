from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class WirelessSnapshot(Base):
    __tablename__ = "wireless_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    controller_id = Column(String(100), index=True, default="")
    controller_name = Column(String(255), default="")
    source = Column(String(100), default="")
    ap_key = Column(String(255), index=True, default="")
    ap_name = Column(String(255), default="")
    status = Column(String(100), default="")
    clients = Column(Integer, default=0)
    radios = Column(Integer, default=0)
    cpu_util = Column(Integer, default=0)
    memory_util = Column(Integer, default=0)
    traffic_rx_rate = Column(Integer, default=0)
    traffic_tx_rate = Column(Integer, default=0)
    traffic_rx_bytes = Column(Integer, default=0)
    traffic_tx_bytes = Column(Integer, default=0)
    dropped_packets = Column(Integer, default=0)
    lan_rx_errors = Column(Integer, default=0)
    payload = Column(Text, default="{}")
    sampled_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
