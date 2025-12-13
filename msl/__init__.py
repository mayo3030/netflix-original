"""
Netflix MSL (Message Security Layer) Implementation
====================================================
Handles secure communication with Netflix API.
"""

from .client import MSLClient
from .crypto import MSLCrypto

__all__ = ['MSLClient', 'MSLCrypto']

