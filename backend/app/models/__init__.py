# app/models/__init__.py
#
# Purpose: Makes `app.models` a package and exports all SQLAlchemy models.
#
# Why import models here?
# SQLAlchemy models register themselves with Base.metadata the moment their
# class body is executed — which happens when the module is first imported.
# Base.metadata.create_all() only creates tables it knows about.
#
# By importing all models here, any code that does `import app.models`
# (including our test fixtures and Alembic migration scripts) will
# automatically register every model with Base.metadata.
#
# As we add more models (Account, Transaction, etc.), they get added here.

from app.models.user import User
from app.models.account import Account
from app.models.category import Category
from app.models.schedule import Schedule
from app.models.transaction import Transaction
from app.models.reallocation import Reallocation

__all__ = ["User", "Account", "Category", "Schedule", "Transaction", "Reallocation"]
